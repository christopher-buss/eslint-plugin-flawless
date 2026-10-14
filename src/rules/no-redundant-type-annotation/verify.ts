import path from "node:path";
import ts from "typescript";

// cspell:ignore unredirected

/** An annotation that has already passed the rule's inexpensive checks. */
export interface Candidate {
	readonly owner: ts.ParameterDeclaration | ts.VariableDeclaration;
	readonly range: readonly [number, number];
}

export interface Verification<C extends Candidate> {
	/** Removals proven safe; these may be autofixed. */
	readonly accepted: ReadonlyArray<C>;
	/** Removals that change a type or need their annotation; not reported. */
	readonly rejected: ReadonlyArray<{ readonly candidate: C; readonly reason: string }>;
	/**
	 * Removals left unchecked by the work limit. These may be reported, but
	 * never autofixed; a later fix pass verifies them.
	 */
	readonly unverified: ReadonlyArray<{ readonly candidate: C; readonly reason: string }>;
}

/** The rejection reason prefix when the compiler fails during verification. */
export const COMPILER_FAILURE = "The compiler could not verify this removal";

// Individual editor fixes and a combined ESLint fix both need checking. Leave
// two programs for the combined fix and a retry after rejecting a dependency.
const MAX_PROGRAMS = 12;
// Query order is compiler behavior, not a public contract. Validate new
// versions against full diagnostics before enabling loop replay on them.
const LOOP_REPLAY_VERSIONS = new Set(["5.9", "6.0"]);
const EMIT_FLAGS =
	ts.NodeBuilderFlags.MultilineObjectLiterals |
	ts.NodeBuilderFlags.WriteClassExpressionAsTypeLiteral |
	ts.NodeBuilderFlags.UseTypeOfFunction |
	ts.NodeBuilderFlags.UseStructuralFallback |
	ts.NodeBuilderFlags.AllowEmptyTuple |
	ts.NodeBuilderFlags.GenerateNamesForShadowedTypeParams |
	ts.NodeBuilderFlags.NoTruncation;

/**
 * Rechecks individual removals and the resulting combined fix. This is a
 * conservative filter, not a substitute for full compiler diagnostics. No
 * speculative checker survives the lint, and failures leave annotations alone.
 * @template C - The rule's candidate, including its report metadata.
 * @param program - The parser's program, including unsaved source buffers.
 * @param source - The source file whose annotations may be removed.
 * @param candidates - Removals that passed the rule's existing guards.
 * @returns Verified, rejected, and unchecked removals.
 */
export function verifyAnnotations<C extends Candidate>(
	program: ts.Program,
	source: ts.SourceFile,
	candidates: ReadonlyArray<C>,
): Verification<C> {
	const rejected: Array<{ candidate: C; reason: string }> = [];
	const unverified: Array<{ candidate: C; reason: string }> = [];
	function recordRejection(candidate: C, reason: string): void {
		rejected.push({ candidate, reason });
	}

	if (candidates.length === 0) {
		return { accepted: [], rejected, unverified };
	}

	try {
		const checker = program.getTypeChecker();
		const options = program.getCompilerOptions();
		const emitsDeclarations = options.declaration === true || options.composite === true;
		const speculate = speculativeProgramFactory(program, source);
		const print = createTypePrinter();
		const assertionTargets = requiredAssertionTargets(checker, source, candidates);
		const eligible = candidates.filter((candidate) => {
			if (assertionTargets.has(candidate.owner)) {
				recordRejection(candidate, "Assertion call targets require an explicit annotation");
				return false;
			}

			if (insideLoop(candidate.owner) && !LOOP_REPLAY_VERSIONS.has(ts.versionMajorMinor)) {
				recordRejection(
					candidate,
					"Loop replay has not been validated for this compiler version",
				);
				return false;
			}

			return true;
		});
		const selected = eligible.slice(0, MAX_PROGRAMS - 2);
		const references = referencesByOwner(checker, source, selected);
		const snapshots = new Map(
			selected.map((candidate) => {
				return [
					candidate,
					observedNodes(candidate, references.get(candidate.owner) ?? []).map((node) => {
						return { node, type: print(checker, node, declarationKey) };
					}),
				];
			}),
		);
		let programs = 0;
		function check(group: ReadonlyArray<C>): Map<C, string> {
			programs += 1;
			const ranges = group.map(({ range }) => range).sort((a, b) => a[0] - b[0]);
			const modified = speculate(removeRanges(source.text, ranges));
			const after = modified.getSourceFile(source.fileName);
			if (after === undefined) {
				throw new Error("The speculative program lost the source file");
			}

			const fresh = modified.getTypeChecker();
			const index = indexNodes(after);
			/**
			 * Keys declarations in the edited file by their original position,
			 * so a shadowing declaration never matches the one it shadows.
			 * @param declaration - A declaration in the speculative program.
			 * @returns The key of the same declaration in the original program.
			 */
			function originalKey(declaration: ts.Node): string {
				return declarationKey(declaration, (position, file) => {
					return file === after ? unmapPosition(position, ranges) : position;
				});
			}

			function mapped(node: ts.Node): ts.Node | undefined {
				return index.get(
					nodeKey(
						node.kind,
						mapPosition(node.getStart(source), ranges),
						mapPosition(node.end, ranges),
					),
				);
			}

			// Queries populate checker caches. Replay every affected loop's scope
			// before querying any candidate, including candidates outside loops.
			const replayed = new Set<ts.Node>();
			for (const candidate of group) {
				if (insideLoop(candidate.owner)) {
					const root = loopScope(candidate.owner);
					const replacement = ts.isSourceFile(root) ? after : mapped(root);
					if (replacement === undefined) {
						throw new Error("Cannot locate the affected function");
					}

					if (!replayed.has(replacement)) {
						replay(fresh, replacement);
						replayed.add(replacement);
					}
				}
			}

			const problems = new Map<C, string>();
			for (const candidate of group) {
				for (const { node, type } of snapshots.get(candidate) ?? []) {
					const replacement = mapped(node);
					const inferred =
						replacement === undefined
							? undefined
							: print(fresh, replacement, originalKey);
					if (inferred !== type) {
						problems.set(
							candidate,
							`Removing the annotation changes an observed type: ${type} -> ${inferred ?? "missing node"}`,
						);
						break;
					}
				}

				if (
					!problems.has(candidate) &&
					emitsDeclarations &&
					affectsDeclarationEmit(candidate.owner)
				) {
					const owner = mapped(candidate.owner);
					if (owner === undefined || !canNameType(fresh, owner)) {
						problems.set(
							candidate,
							"The inferred type cannot be safely named for declaration emit",
						);
					}
				}
			}

			return problems;
		}

		// Bound speculative work independently of the number of annotations in
		// the file. Additional candidates are reported without a fix; a later
		// fix pass verifies them once earlier fixes are applied.
		let accepted = selected;
		for (const candidate of eligible.slice(MAX_PROGRAMS - 2)) {
			unverified.push({ candidate, reason: "The verification work limit was reached" });
		}

		if (accepted.length > 1) {
			accepted = accepted.filter((candidate) => {
				const reason = check([candidate]).get(candidate);
				if (reason !== undefined) {
					recordRejection(candidate, reason);
					return false;
				}

				return true;
			});
		}

		while (accepted.length > 0 && programs < MAX_PROGRAMS) {
			const problems = check(accepted);
			if (problems.size === 0) {
				return { accepted, rejected, unverified };
			}

			// Restore one annotation first: restoring a context provider can
			// make the other removals safe. Dropping all affected parameters at
			// once would discard those reports unnecessarily.
			const restored =
				accepted.find(
					(candidate) =>
						problems.has(candidate) && ts.isVariableDeclaration(candidate.owner),
				) ?? accepted.find((candidate) => problems.has(candidate));
			if (restored !== undefined) {
				recordRejection(
					restored,
					problems.get(restored) ?? "The combined removal changes a type",
				);
				accepted = accepted.filter((candidate) => candidate !== restored);
			}
		}

		for (const candidate of accepted) {
			unverified.push({ candidate, reason: "The verification work limit was reached" });
		}
	} catch (err) {
		// A host/API mismatch or an unsupported compiler must never turn an
		// unverified removal into an autofix or into a report the user cannot
		// act on. The compatibility CI job keeps this path from going unseen.
		const reason = `${COMPILER_FAILURE}: ${err instanceof Error ? err.message : String(err)}`;
		const recorded = new Set([...rejected, ...unverified].map(({ candidate }) => candidate));
		for (const candidate of candidates) {
			if (!recorded.has(candidate)) {
				recordRejection(candidate, reason);
			}
		}
	}

	return { accepted: [], rejected, unverified };
}

/**
 * Declarations needed to meet assertion calls' syntactic requirements.
 * @param checker - The original checker, with the annotations still present.
 * @param source - The source whose assertion calls are inspected.
 * @param candidates - Variable and function-expression parameter removals.
 * @returns Declarations that must retain their explicit annotations.
 */
function requiredAssertionTargets(
	checker: ts.TypeChecker,
	source: ts.SourceFile,
	candidates: ReadonlyArray<Candidate>,
): Set<ts.Node> {
	const required = new Set<ts.Node>();
	const bindings = new Map<
		string,
		Array<{ owner: Candidate["owner"]; symbol: ts.Symbol | undefined }>
	>();
	function names(binding: ts.BindingName): Array<ts.Identifier> {
		if (ts.isIdentifier(binding)) {
			return [binding];
		}

		return binding.elements.flatMap((element) => {
			return ts.isBindingElement(element) ? names(element.name) : [];
		});
	}

	function asserts(signature: ts.Signature | undefined): boolean {
		const predicate =
			signature === undefined ? undefined : checker.getTypePredicateOfSignature(signature);
		return (
			predicate?.kind === ts.TypePredicateKind.AssertsIdentifier ||
			predicate?.kind === ts.TypePredicateKind.AssertsThis
		);
	}

	for (const { owner } of candidates) {
		const type = checker.getTypeAtLocation(owner.name);
		if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).some(asserts)) {
			// Exported assertion functions can also be called from other files.
			required.add(owner);
		}

		for (const name of names(owner.name)) {
			const group = bindings.get(name.text) ?? [];
			group.push({ owner, symbol: checker.getSymbolAtLocation(name) });
			bindings.set(name.text, group);
		}
	}

	if (bindings.size === 0) {
		return required;
	}

	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node)) {
			const referenced: Array<ts.Node> = [];
			function callee(part: ts.Node): void {
				if (ts.isIdentifier(part)) {
					const group = bindings.get(part.text);
					if (group !== undefined) {
						const symbol = checker.getSymbolAtLocation(part);
						for (const candidate of group) {
							if (
								symbol !== undefined &&
								(symbol === candidate.symbol ||
									symbol.valueDeclaration === candidate.owner)
							) {
								referenced.push(candidate.owner);
							}
						}
					}
				}

				ts.forEachChild(part, callee);
			}

			callee(node.expression);
			if (referenced.length > 0 && asserts(checker.getResolvedSignature(node))) {
				for (const owner of referenced) {
					required.add(owner);
				}
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(source);
	return required;
}

function fileKey(name: string): string {
	const resolved = path.resolve(name).replaceAll("\\", "/");
	return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
}

/**
 * Builds programs that differ from `old` only in the text of `source`. The
 * file map and the base host are built once and shared by every program.
 * @param old - The parser's program.
 * @param source - The file whose text each program replaces.
 * @returns A function that creates a program for a replacement text.
 */
function speculativeProgramFactory(
	old: ts.Program,
	source: ts.SourceFile,
): (text: string) => ts.Program {
	const options = old.getCompilerOptions();
	const base = ts.createCompilerHost(options, true);
	const files = new Map(old.getSourceFiles().map((file) => [fileKey(file.fileName), file]));
	const target = fileKey(source.fileName);
	const projectReferences = old.getProjectReferences();
	const rootNames = old.getRootFileNames();
	let { text } = source;
	const host: ts.CompilerHost = {
		...base,
		fileExists: (name) => {
			return (
				old.getSourceFile(name) !== undefined ||
				files.has(fileKey(name)) ||
				base.fileExists(name)
			);
		},
		getCurrentDirectory: () => old.getCurrentDirectory(),
		getSourceFile(name, languageVersion, onError, shouldCreate) {
			if (fileKey(name) === target) {
				return ts.createSourceFile(name, text, languageVersion, true);
			}

			const existing:
				| (ts.SourceFile & {
						redirectInfo?: { unredirected: ts.SourceFile };
				  })
				| undefined = old.getSourceFile(name) ?? files.get(fileKey(name));
			// TypeScript forbids returning a package redirect from a compiler
			// host. This internal compatibility detail stays confined here.
			return (
				existing?.redirectInfo?.unredirected ??
				existing ??
				base.getSourceFile(name, languageVersion, onError, shouldCreate)
			);
		},
		readFile: (name) => {
			return fileKey(name) === target
				? text
				: (old.getSourceFile(name)?.text ??
						files.get(fileKey(name))?.text ??
						base.readFile(name));
		},
	};
	const programOptions: ts.CreateProgramOptions = { host, oldProgram: old, options, rootNames };
	if (projectReferences !== undefined) {
		programOptions.projectReferences = projectReferences;
	}

	return (replacement) => {
		// createProgram reads every file synchronously, so the shared host
		// never serves two texts to one program.
		text = replacement;
		return ts.createProgram(programOptions);
	};
}

function removeRanges(text: string, ranges: ReadonlyArray<readonly [number, number]>): string {
	let output = "";
	let end = 0;
	for (const [start, next] of ranges) {
		if (start < end || next < start || next > text.length) {
			throw new Error("Invalid annotation range");
		}

		output += text.slice(end, start);
		end = next;
	}

	return output + text.slice(end);
}

function mapPosition(position: number, ranges: ReadonlyArray<readonly [number, number]>): number {
	let shift = 0;
	for (const [start, end] of ranges) {
		if (end <= position) {
			shift += end - start;
		}
	}

	return position - shift;
}

/**
 * Maps a position in the edited text back to the original text.
 * @param position - A position in the edited text.
 * @param ranges - The removed ranges, sorted, in original positions.
 * @returns The original position of the same character.
 */
function unmapPosition(position: number, ranges: ReadonlyArray<readonly [number, number]>): number {
	let shift = 0;
	for (const [start, end] of ranges) {
		if (position + shift < start) {
			break;
		}

		shift += end - start;
	}

	return position + shift;
}

/**
 * Identifies a declaration by file and start, the same across programs.
 * @param declaration - A node that declares a symbol named in a type.
 * @param translate - Maps a start in the declaring file to an original start.
 * @returns A key equal for the same declaration in either program.
 */
function declarationKey(
	declaration: ts.Node,
	translate: (position: number, file: ts.SourceFile) => number = (position) => position,
): string {
	const file = declaration.getSourceFile();
	return `${fileKey(file.fileName)}:${translate(declaration.getStart(file), file)}`;
}

function nodeKey(kind: ts.SyntaxKind, start: number, end: number): string {
	return `${kind}:${start}:${end}`;
}

function indexNodes(source: ts.SourceFile): Map<string, ts.Node> {
	const index = new Map<string, ts.Node>();
	function visit(node: ts.Node): void {
		index.set(nodeKey(node.kind, node.getStart(source), node.end), node);
		ts.forEachChild(node, visit);
	}

	visit(source);
	return index;
}

function insideLoop(node: ts.Node): boolean {
	for (let { parent } = node; !ts.isSourceFile(parent); { parent } = parent) {
		if (ts.isIterationStatement(parent, false)) {
			return true;
		}
	}

	return false;
}

/**
 * The scope to replay for a candidate in a loop: the nearest function, or the
 * file, that contains the candidate's outermost loop.
 * @param node - A candidate inside a loop.
 * @returns The function-like node or source file to replay.
 */
function loopScope(node: ts.Node): ts.Node {
	let loop: ts.Node | undefined;
	for (let { parent } = node; !ts.isSourceFile(parent); { parent } = parent) {
		if (ts.isIterationStatement(parent, false)) {
			loop = parent;
		}
	}

	for (let current = loop?.parent; current !== undefined; current = current.parent) {
		if (ts.isFunctionLike(current) || ts.isSourceFile(current)) {
			return current;
		}
	}

	return node.getSourceFile();
}

/**
 * Whether declaration emit can print the candidate's type. Declarations in a
 * function body, and parameters of functions there, never reach a `.d.ts`.
 * @param owner - The candidate's declaration.
 * @returns False when the owner is inside a function body.
 */
function affectsDeclarationEmit(owner: Candidate["owner"]): boolean {
	for (let node: ts.Node = owner; !ts.isSourceFile(node.parent); node = node.parent) {
		const { parent } = node;
		if (ts.isFunctionLike(parent) && "body" in parent && parent.body === node) {
			return false;
		}
	}

	return true;
}

/**
 * Finds uses of each candidate's binding in the file. Removing an annotation
 * can change a use site's contextual type or overload choice.
 * @param checker - The original checker.
 * @param source - The file to search.
 * @param candidates - The candidates whose bindings are searched for.
 * @returns The referencing identifiers of each candidate owner.
 */
function referencesByOwner(
	checker: ts.TypeChecker,
	source: ts.SourceFile,
	candidates: ReadonlyArray<Candidate>,
): Map<ts.Node, Array<ts.Identifier>> {
	const owners = new Map<ts.Symbol, Candidate["owner"]>();
	const names = new Set<string>();
	for (const { owner } of candidates) {
		const symbol = ts.isIdentifier(owner.name)
			? checker.getSymbolAtLocation(owner.name)
			: undefined;
		if (symbol !== undefined) {
			owners.set(symbol, owner);
			names.add(symbol.name);
		}
	}

	const references = new Map<ts.Node, Array<ts.Identifier>>();
	function visit(node: ts.Node): void {
		if (ts.isTypeNode(node)) {
			return;
		}

		if (ts.isIdentifier(node) && names.has(node.text)) {
			const symbol = checker.getSymbolAtLocation(node);
			const owner = symbol === undefined ? undefined : owners.get(symbol);
			if (owner !== undefined && owner.name !== node) {
				const list = references.get(owner) ?? [];
				list.push(node);
				references.set(owner, list);
			}
		}

		ts.forEachChild(node, visit);
	}

	if (owners.size > 0) {
		visit(source);
	}

	return references;
}

function replay(checker: ts.TypeChecker, root: ts.Node): void {
	function visit(node: ts.Node): void {
		if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
			checker.getTypeAtLocation(node.name);
		} else if (ts.isExpression(node) && !ts.isTypeNode(node)) {
			checker.getTypeAtLocation(node);
		}

		ts.forEachChild(node, visit);
	}

	visit(root);
}

function observedNodes(
	candidate: Candidate,
	references: ReadonlyArray<ts.Identifier>,
): Array<ts.Node> {
	const nodes: Array<ts.Node> = [candidate.owner];
	if (ts.isParameter(candidate.owner)) {
		nodes.push(candidate.owner.parent);
	}

	// A use site's parent observes its contextual typing and overload choice,
	// as in `register(handler)` or `handler = (event) => event.detail`.
	for (const reference of references) {
		nodes.push(reference, reference.parent);
	}

	const root = candidate.owner.initializer;

	function visit(node: ts.Node): void {
		if (ts.isTypeNode(node)) {
			return;
		}

		if (
			ts.isVariableDeclaration(node) ||
			ts.isParameter(node) ||
			ts.isPropertyDeclaration(node) ||
			ts.isCallExpression(node) ||
			ts.isNewExpression(node) ||
			ts.isTaggedTemplateExpression(node) ||
			ts.isFunctionLike(node)
		) {
			nodes.push(node);
		}

		ts.forEachChild(node, visit);
	}

	if (root !== undefined) {
		visit(root);
	}

	return nodes;
}

/**
 * Normalize property ordering, preserving every overload and intersection.
 * Names are qualified with their declarations, so two types that print the
 * same, such as a shadowed `Options`, compare as different.
 * @returns A type printer with a cache scoped to this verification run.
 */
function createTypePrinter(): (
	checker: ts.TypeChecker,
	node: ts.Node,
	locate: (declaration: ts.Node) => string,
) => string {
	const cache = new Map<string, string>();
	const printer = ts.createPrinter({ removeComments: true });
	function declarations(
		checker: ts.TypeChecker,
		type: ts.Type,
		locate: (declaration: ts.Node) => string,
	): string {
		const keys = new Set<string>();
		function add(name: ts.EntityName): void {
			const identifier = ts.isQualifiedName(name) ? name.right : name;
			// The node builder attaches the symbol each emitted name denotes.
			const { symbol } = identifier as ts.Node & { symbol?: ts.Symbol };
			const declaration = symbol?.declarations?.[0];
			if (declaration !== undefined) {
				keys.add(`${identifier.text}@${locate(declaration)}`);
			}
		}

		function visit(current: ts.Node): void {
			if (ts.isTypeReferenceNode(current)) {
				add(current.typeName);
			} else if (ts.isTypeQueryNode(current)) {
				add(current.exprName);
			}

			ts.forEachChild(current, visit);
		}

		const node = checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.NoTruncation);
		if (node !== undefined) {
			visit(node);
		}

		return [...keys].sort().join(", ");
	}

	return (checker, node, locate) => {
		const target =
			ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)
				? node.name
				: node;
		const type = checker.getTypeAtLocation(target);
		const text = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
		const suffix = ` [${declarations(checker, type, locate)}]`;
		const cached = cache.get(text);
		if (cached !== undefined) {
			return cached + suffix;
		}

		const source = ts.createSourceFile(
			"type.ts",
			`type Result = ${text};`,
			ts.ScriptTarget.Latest,
			true,
		);
		const transformed = ts.transform(source, [
			(context) => {
				function visit(original: ts.Node): ts.Node {
					const updated = ts.visitEachChild(original, visit, context);
					if (
						ts.isTypeLiteralNode(updated) &&
						updated.members.every(ts.isPropertySignature)
					) {
						const members = [...updated.members].sort((a, b) => {
							const left = printer.printNode(ts.EmitHint.Unspecified, a, source);
							const right = printer.printNode(ts.EmitHint.Unspecified, b, source);
							if (left === right) {
								return 0;
							}

							return left < right ? -1 : 1;
						});
						return context.factory.updateTypeLiteralNode(
							updated,
							context.factory.createNodeArray(members),
						);
					}

					return updated;
				}

				return (root) => ts.visitNode(root, visit) as ts.SourceFile;
			},
		]);
		try {
			const [resultFile] = transformed.transformed;
			if (resultFile === undefined) {
				throw new Error("The type printer produced no output");
			}

			const result = printer.printFile(resultFile).trim();
			cache.set(text, result);
			return result + suffix;
		} finally {
			transformed.dispose();
		}
	};
}

/**
 * A name check can reject unsafe emit; passing it is not an emit guarantee.
 * @param checker - The speculative program's checker.
 * @param declaration - The declaration whose inferred type must be named.
 * @returns Whether all serialized names resolve to the intended symbols.
 */
function canNameType(checker: ts.TypeChecker, declaration: ts.Node): boolean {
	const type = checker.getTypeAtLocation(
		ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)
			? declaration.name
			: declaration,
	);
	const node = checker.typeToTypeNode(type, declaration, EMIT_FLAGS);
	if (node === undefined) {
		return false;
	}

	function resolveAlias(symbol: ts.Symbol): ts.Symbol {
		return (symbol.flags & ts.SymbolFlags.Alias) !== 0
			? checker.getAliasedSymbol(symbol)
			: symbol;
	}

	function resolve(
		name: ts.EntityName | ts.Expression,
		meaning: ts.SymbolFlags,
	): ts.Symbol | undefined {
		if (ts.isIdentifier(name)) {
			return checker.resolveName(name.text, declaration, meaning, false);
		}

		if (ts.isQualifiedName(name) || ts.isPropertyAccessExpression(name)) {
			const left = resolve(
				ts.isQualifiedName(name) ? name.left : name.expression,
				ts.SymbolFlags.Namespace | ts.SymbolFlags.Value | ts.SymbolFlags.Type,
			);
			if (left === undefined) {
				return undefined;
			}

			const symbol = resolveAlias(left);
			const right = ts.isQualifiedName(name) ? name.right.text : name.name.text;
			return (symbol.flags & ts.SymbolFlags.Namespace) !== 0
				? checker.getExportsOfModule(symbol).find((member) => member.name === right)
				: checker.getPropertyOfType(
						checker.getTypeOfSymbolAtLocation(symbol, declaration),
						right,
					);
		}

		return undefined;
	}

	function matches(name: ts.EntityName | ts.Expression, meaning: ts.SymbolFlags): boolean {
		let identifier: ts.Node = name;
		if (ts.isQualifiedName(name)) {
			identifier = name.right;
		} else if (ts.isPropertyAccessExpression(name)) {
			identifier = name.name;
		}

		// The node builder attaches the symbol it intends each emitted name to
		// denote. Missing metadata is inconclusive, never permission to remove.
		const expected = (identifier as ts.Node & { symbol?: ts.Symbol }).symbol;
		if (expected === undefined) {
			return false;
		}

		if ((expected.flags & ts.SymbolFlags.TypeParameter) !== 0) {
			return true;
		}

		const actual = resolve(name, meaning);
		return actual !== undefined && resolveAlias(actual) === resolveAlias(expected);
	}

	let safe = true;
	function visit(current: ts.Node): void {
		if (!safe) {
			return;
		}

		if (ts.isTypeReferenceNode(current)) {
			safe = matches(current.typeName, ts.SymbolFlags.Type | ts.SymbolFlags.Namespace);
		} else if (ts.isTypeQueryNode(current)) {
			safe = matches(current.exprName, ts.SymbolFlags.Value | ts.SymbolFlags.Namespace);
		} else if (ts.isComputedPropertyName(current)) {
			safe =
				ts.isStringLiteral(current.expression) ||
				ts.isNumericLiteral(current.expression) ||
				matches(current.expression, ts.SymbolFlags.Value | ts.SymbolFlags.Namespace);
		} else if (ts.isImportTypeNode(current)) {
			// Resolving synthesized import paths requires the emitter's complete
			// accessibility machinery. Leave the annotation in that case.
			safe = false;
		}

		ts.forEachChild(current, visit);
	}

	visit(node);
	return safe;
}
