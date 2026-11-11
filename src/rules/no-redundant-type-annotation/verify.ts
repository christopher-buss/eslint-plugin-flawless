import path from "node:path";
import ts from "typescript";

// cspell:ignore unredirected

/** An annotation that has already passed the rule's inexpensive checks. */
export interface Candidate {
	readonly owner:
		| ts.ArrowFunction
		| ts.FunctionDeclaration
		| ts.FunctionExpression
		| ts.MethodDeclaration
		| ts.ParameterDeclaration
		| ts.VariableDeclaration;
	readonly range: readonly [number, number];
	/**
	 * The removal is reported only when it is proven safe alone. It is
	 * selected first. A coupled one is checked alone before the combined
	 * check, and an uncoupled one when a combined check finds a problem with
	 * it. These checks are apart from the work limit of the other checks.
	 */
	readonly requiresProof?: boolean;
}

export interface Verification<C extends Candidate> {
	/** Removals proven safe; these may be autofixed. */
	readonly accepted: ReadonlyArray<C>;
	/**
	 * Removals that require proof, proven safe alone but not in the combined
	 * fix. These may be reported, but never autofixed.
	 */
	readonly acceptedAlone: ReadonlyArray<C>;
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

/** The unverified reason when the parser loaded another TypeScript copy. */
export const FOREIGN_COMPILER =
	"The parser uses another copy of TypeScript, so removals cannot be verified";

let sourceFileConstructor: unknown;

/**
 * Whether the parser built `source` with this module's copy of TypeScript.
 * @param source - A source file from the parser's program.
 * @returns True when both use the same compiler instance.
 */
function sharesCompiler(source: ts.SourceFile): boolean {
	sourceFileConstructor ??= ts.createSourceFile(
		"probe.ts",
		"",
		ts.ScriptTarget.Latest,
	).constructor;
	return source.constructor === sourceFileConstructor;
}

// Individual editor fixes and a combined ESLint fix both need checking. Leave
// two programs for the combined fix and a retry after rejecting a dependency.
// The check alone of a removal that requires proof is not in this budget.
// Each selected removal gets at most one check alone, plus one shared check
// in which all removals fail, and each combined check restores at least one
// removal, so one lint creates at most 2 * (MAX_PROGRAMS - 2) + 1 programs.
const MAX_PROGRAMS = 12;
// Query order is compiler behavior, not a public contract. Validate new
// versions against full diagnostics before enabling loop replay on them.
const LOOP_REPLAY_VERSIONS = new Set(["5.9", "6.0"]);
// Compiler hosts can resolve module name literals from TypeScript 5.0.
const RESOLVES_LITERALS = Number(ts.versionMajorMinor.split(".", 1)[0]) >= 5;
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
		return { accepted: [], acceptedAlone: [], rejected, unverified };
	}

	// TypeScript numbers nodes and symbols from module-level counters. A
	// second copy of the compiler would assign colliding ids to the parser's
	// shared nodes, corrupting both checkers.
	if (!sharesCompiler(source)) {
		return {
			accepted: [],
			acceptedAlone: [],
			rejected,
			unverified: candidates.map((candidate) => ({ candidate, reason: FOREIGN_COMPILER })),
		};
	}

	try {
		const checker = program.getTypeChecker();
		const options = program.getCompilerOptions();
		const emitsDeclarations = options.declaration === true || options.composite === true;
		const speculate = speculativeProgramFactory(program, source);
		const print = createTypePrinter();
		const assertionTargets = requiredAssertionTargets(checker, source, candidates);
		// A removal that requires proof goes first, so other removals cannot
		// push it past the work limit.
		const eligible = [
			...candidates.filter(({ requiresProof }) => requiresProof === true),
			...candidates.filter(({ requiresProof }) => requiresProof !== true),
		].filter((candidate) => {
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
		// The uses each candidate can narrow as an aliased condition. They are
		// observed, and they couple the candidate with other removals.
		const narrowed = new Map<C, ReadonlyArray<ts.Node>>();
		// Original types are printed on first comparison. A rejected removal
		// usually differs at its declaration, so its other uses are never
		// printed.
		const snapshots = new Map(
			selected.map((candidate) => {
				const receiving = receivingCall(candidate.owner);
				const ownerReferences = references.get(candidate.owner) ?? [];
				const aliasNodes = aliasNarrowedNodes(checker, candidate.owner, ownerReferences);
				narrowed.set(candidate, aliasNodes);
				return [
					candidate,
					[...observedNodes(candidate, ownerReferences, receiving), ...aliasNodes].map(
						(node) => {
							let type: string | undefined;
							const omitThis = receiving?.arrows.has(node) === true;
							return {
								node,
								omitThis,
								original: (): string => {
									type ??= print(checker, node, declarationKey, omitThis);
									return type;
								},
							};
						},
					),
				];
			}),
		);
		function check(group: ReadonlyArray<C>): Map<C, string> {
			const ranges = group.map(({ range }) => range).sort((a, b) => a[0] - b[0]);
			const modified = speculate(removeRanges(source.text, ranges));
			const edited = modified.getSourceFile(source.fileName);
			if (edited === undefined) {
				throw new Error("The speculative program lost the source file");
			}

			const after = edited;

			const fresh = modified.getTypeChecker();
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
				return findNode(
					after,
					node.kind,
					mapPosition(node.getStart(source), ranges),
					mapPosition(node.end, ranges),
				);
			}

			/**
			 * Finds the first observed type that the removal changes.
			 * @param candidate - The removal to check.
			 * @returns A description of the change, or undefined when none.
			 */
			function findObservedChange(candidate: C): string | undefined {
				const observed = snapshots.get(candidate) ?? [];
				for (const { node, omitThis, original } of observed) {
					const replacement = mapped(node);
					const inferred =
						replacement === undefined
							? undefined
							: print(fresh, replacement, originalKey, omitThis);
					const type = original();
					if (inferred !== type) {
						return `Removing the annotation changes an observed type: ${type} -> ${inferred ?? "missing node"}`;
					}
				}

				return undefined;
			}

			// Queries populate checker caches. Replay every affected loop's scope
			// before querying any candidate, including candidates outside loops.
			const replayed = new Set<ts.Node>();
			for (const candidate of group) {
				if (!insideLoop(candidate.owner)) {
					continue;
				}

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

			const problems = new Map<C, string>();
			for (const candidate of group) {
				// Naming queries only the declaration, while observed types
				// check every use. Run the inexpensive rejection first.
				if (emitsDeclarations && affectsDeclarationEmit(candidate.owner)) {
					const owner = mapped(candidate.owner);
					if (owner === undefined || !canNameType(fresh, owner)) {
						problems.set(
							candidate,
							"The inferred type cannot be safely named for declaration emit",
						);
						continue;
					}
				}

				const change = findObservedChange(candidate);
				if (change !== undefined) {
					problems.set(candidate, change);
				}
			}

			return problems;
		}

		/**
		 * Finds the problem of each coupled removal when it is the only
		 * removal. Removals that are not coupled with one another share one
		 * program, as uncoupled removals do in the combined check. A removal
		 * with a problem there gets a program of its own, so another removal
		 * never causes its rejection. After a shared program in which all
		 * removals have a problem, each removal gets a program of its own.
		 * Thus at most one program more than the number of removals is used.
		 * @param partners - The removals coupled with each coupled removal.
		 * @returns The problem of each coupled removal alone, if any.
		 */
		function checkAlone(partners: ReadonlyMap<C, ReadonlySet<C>>): Map<C, string | undefined> {
			const groups: Array<Array<C>> = [];
			for (const [candidate, coupledWith] of partners) {
				const group = groups.find((members) => {
					return members.every((member) => !coupledWith.has(member));
				});
				if (group === undefined) {
					groups.push([candidate]);
				} else {
					group.push(candidate);
				}
			}

			const problems = new Map<C, string | undefined>();
			let batching = true;
			for (const group of groups) {
				if (!batching || group.length === 1) {
					for (const candidate of group) {
						problems.set(candidate, check([candidate]).get(candidate));
					}

					continue;
				}

				const shared = check(group);
				batching = group.some((candidate) => !shared.has(candidate));
				for (const candidate of group) {
					problems.set(
						candidate,
						shared.has(candidate) ? check([candidate]).get(candidate) : undefined,
					);
				}
			}

			return problems;
		}

		// Bound speculative work independently of the number of annotations in
		// the file. Additional candidates are reported without a fix; a later
		// fix pass verifies them once earlier fixes are applied.
		const overLimit = eligible.slice(MAX_PROGRAMS - 2);
		for (const candidate of overLimit) {
			unverified.push({ candidate, reason: "The verification work limit was reached" });
		}

		// An editor applies one fix at a time. Removals that cannot influence
		// one another are safe alone when they are safe together, so only
		// coupled removals need a check alone. A removal that requires proof
		// is reported only when it is safe alone. Its check is not in the
		// budget, so other removals cannot use up its check.
		let programs = 0;
		const safeAlone = new Set<C>();
		const coupled = coupledCandidates(selected, references, narrowed);
		const aloneProblems = checkAlone(coupled);
		let accepted = selected.filter((candidate) => {
			if (!coupled.has(candidate)) {
				return true;
			}

			const requiresProof = candidate.requiresProof === true;
			if (!requiresProof) {
				programs += 1;
			}

			const reason = aloneProblems.get(candidate);
			if (reason !== undefined) {
				recordRejection(candidate, reason);
				return false;
			}

			if (requiresProof) {
				safeAlone.add(candidate);
			}

			return true;
		});
		// A removal that requires proof and is safe alone, but not verified
		// in the combined fix, is reported without a fix.
		const acceptedAlone: Array<C> = [];
		function leaveUnfixed(candidate: C, reason: string): void {
			if (safeAlone.has(candidate)) {
				acceptedAlone.push(candidate);
			} else {
				unverified.push({ candidate, reason });
			}
		}

		while (accepted.length > 0 && programs < MAX_PROGRAMS) {
			programs += 1;
			const problems = check(accepted);
			if (problems.size === 0) {
				return { accepted, acceptedAlone, rejected, unverified };
			}

			// The coupled removals use at most ten of the budget above, so this
			// check runs at least once. An uncoupled removal without a problem
			// here is safe alone.
			for (const candidate of accepted) {
				if (
					candidate.requiresProof === true &&
					!coupled.has(candidate) &&
					!problems.has(candidate)
				) {
					safeAlone.add(candidate);
				}
			}

			// The coupling analysis does not follow all data flow, so another
			// removal can cause the problem of an uncoupled removal that
			// requires proof. Check such a removal alone before it is
			// rejected. A removal that requires proof thus gets at most one
			// check alone: here, or above when it is coupled.
			const unchecked = accepted.filter((candidate) => {
				return (
					problems.has(candidate) &&
					candidate.requiresProof === true &&
					!safeAlone.has(candidate)
				);
			});
			for (const candidate of unchecked) {
				const reason = check([candidate]).get(candidate);
				if (reason === undefined) {
					safeAlone.add(candidate);
					acceptedAlone.push(candidate);
				} else {
					recordRejection(candidate, reason);
				}

				problems.delete(candidate);
			}

			accepted = accepted.filter((candidate) => !unchecked.includes(candidate));

			// Other removals cannot cause the problem of an uncoupled
			// candidate, so restore all of those at once. Among coupled
			// candidates, restore one annotation first: restoring a context
			// provider can make the other removals safe.
			const independent = accepted.filter((candidate) => {
				return problems.has(candidate) && !coupled.has(candidate);
			});
			const restored =
				accepted.find((candidate) => {
					return problems.has(candidate) && ts.isVariableDeclaration(candidate.owner);
				}) ?? accepted.find((candidate) => problems.has(candidate));
			let restoring = independent;
			if (restored !== undefined && restoring.length === 0) {
				restoring = [restored];
			}

			for (const candidate of restoring) {
				const reason = problems.get(candidate) ?? "The combined removal changes a type";
				if (safeAlone.has(candidate)) {
					leaveUnfixed(candidate, reason);
				} else {
					recordRejection(candidate, reason);
				}
			}

			accepted = accepted.filter((candidate) => !restoring.includes(candidate));
		}

		for (const candidate of accepted) {
			leaveUnfixed(candidate, "The verification work limit was reached");
		}

		return { accepted: [], acceptedAlone, rejected, unverified };
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

	return { accepted: [], acceptedAlone: [], rejected, unverified };
}

function bindingNames(binding: ts.BindingName): Array<ts.Identifier> {
	if (ts.isIdentifier(binding)) {
		return [binding];
	}

	return binding.elements.flatMap((element) => {
		return ts.isBindingElement(element) ? bindingNames(element.name) : [];
	});
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
	function asserts(signature: ts.Signature | undefined): boolean {
		const predicate =
			signature === undefined ? undefined : checker.getTypePredicateOfSignature(signature);
		return (
			predicate?.kind === ts.TypePredicateKind.AssertsIdentifier ||
			predicate?.kind === ts.TypePredicateKind.AssertsThis
		);
	}

	for (const { owner } of candidates) {
		if (owner.name === undefined) {
			continue;
		}

		const type = checker.getTypeAtLocation(owner.name);
		if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).some(asserts)) {
			// Exported assertion functions can also be called from other files.
			required.add(owner);
		}

		// A method named by a string or computed key binds no name.
		let bound: Array<ts.Identifier> = [];
		if (ts.isVariableDeclaration(owner) || ts.isParameter(owner)) {
			bound = bindingNames(owner.name);
		} else if (ts.isIdentifier(owner.name)) {
			bound = [owner.name];
		}

		for (const name of bound) {
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

const fileKeys = new Map<string, string>();

interface SharedHost {
	readonly base: ts.CompilerHost;
	readonly directoryExists: (name: string) => boolean;
	readonly fileExists: (name: string) => boolean;
	readonly files: ReadonlyMap<string, ts.SourceFile>;
	readonly moduleResolution: ts.ModuleResolutionCache;
	readonly parsedReferences: ReadonlyMap<string, ts.ParsedCommandLine>;
}

function fileKey(name: string): string {
	let key = fileKeys.get(name);
	if (key === undefined) {
		const resolved = path.resolve(name).replaceAll("\\", "/");
		key = ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
		fileKeys.set(name, key);
	}

	return key;
}

// One parser program serves every file of its project. Build its host state
// once: without it, each speculative program re-reads every referenced
// tsconfig and probes the file system for each of the project's files.
// Project references come from the parser's resolution; a reference it could
// not resolve stays unresolved in speculative programs as well.
const sharedHosts = new WeakMap<ts.Program, SharedHost>();

/**
 * The call that receives the callback whose parameter a candidate annotates.
 */
interface ReceivingCall {
	/** The call's arguments that are arrows, without their parentheses. */
	readonly arrows: ReadonlySet<ts.Node>;
	readonly call: ts.CallExpression | ts.NewExpression;
}

/** The parts of a program that the compiler does not make public. */
interface ProgramInternals extends ts.Program {
	readonly getModuleResolutionCache?: () => ts.ModuleResolutionCache | undefined;
}

function memoize(read: (name: string) => boolean): (name: string) => boolean {
	const cache = new Map<string, boolean>();
	return (name) => {
		const cached = cache.get(name);
		if (cached !== undefined) {
			return cached;
		}

		const value = read(name);
		cache.set(name, value);
		return value;
	};
}

function sharedHost(old: ts.Program): SharedHost {
	const cached = sharedHosts.get(old);
	if (cached !== undefined) {
		return cached;
	}

	const options = old.getCompilerOptions();
	const base = ts.createCompilerHost(options, true);
	const parsedReferences = new Map<string, ts.ParsedCommandLine>();
	function collect(references: ReturnType<ts.Program["getResolvedProjectReferences"]>): void {
		const list = references ?? [];
		for (const reference of list) {
			const key =
				reference === undefined ? undefined : fileKey(reference.sourceFile.fileName);
			if (reference !== undefined && key !== undefined && !parsedReferences.has(key)) {
				parsedReferences.set(key, reference.commandLine);
				collect(reference.references);
			}
		}
	}

	collect(old.getResolvedProjectReferences());
	const withInternals: ProgramInternals = old;
	const host: SharedHost = {
		base,
		directoryExists: memoize(
			(name) => base.directoryExists?.(name) ?? ts.sys.directoryExists(name),
		),
		fileExists: memoize((name) => base.fileExists(name)),
		files: new Map(old.getSourceFiles().map((file) => [fileKey(file.fileName), file])),
		moduleResolution: RESOLVES_LITERALS
			? ts.createModuleResolutionCache(
					old.getCurrentDirectory(),
					(name) => base.getCanonicalFileName(name),
					options,
					// The parser program read the package.json scope of each of
					// its files already. Its cache is internal, so it can be
					// absent. TypeScript 5.0 ignores this argument.
					withInternals.getModuleResolutionCache?.()?.getPackageJsonInfoCache(),
				)
			: ts.createModuleResolutionCache(
					old.getCurrentDirectory(),
					(name) => base.getCanonicalFileName(name),
					options,
				),
		parsedReferences,
	};
	sharedHosts.set(old, host);
	return host;
}

/**
 * Builds programs that differ from `old` only in the text of `source`. Host
 * state is shared by every program built from the same parser program.
 * @param old - The parser's program.
 * @param source - The file whose text each program replaces.
 * @returns A function that creates a program for a replacement text.
 */
function speculativeProgramFactory(
	old: ts.Program,
	source: ts.SourceFile,
): (text: string) => ts.Program {
	const { base, directoryExists, fileExists, files, moduleResolution, parsedReferences } =
		sharedHost(old);
	const target = fileKey(source.fileName);
	const projectReferences = old.getProjectReferences();
	let { text } = source;
	const host: ts.CompilerHost = {
		...base,
		directoryExists,
		fileExists: (name) => files.has(fileKey(name)) || fileExists(name),
		getCurrentDirectory: () => old.getCurrentDirectory(),
		getModuleResolutionCache: () => moduleResolution,
		getParsedCommandLine: (name) => parsedReferences.get(fileKey(name)),
		getSourceFile(name, languageVersion, onError, shouldCreate) {
			const key = fileKey(name);
			if (key === target) {
				return ts.createSourceFile(name, text, languageVersion, true);
			}

			const existing:
				| (ts.SourceFile & {
						redirectInfo?: { unredirected: ts.SourceFile };
				  })
				| undefined = files.get(key) ?? old.getSourceFile(name);
			// TypeScript forbids returning a package redirect from a compiler
			// host. This internal compatibility detail stays confined here.
			return (
				existing?.redirectInfo?.unredirected ??
				existing ??
				base.getSourceFile(name, languageVersion, onError, shouldCreate)
			);
		},
		readFile: (name) => {
			const key = fileKey(name);
			return key === target ? text : (files.get(key)?.text ?? base.readFile(name));
		},
	};
	const programOptions: ts.CreateProgramOptions = {
		host,
		oldProgram: old,
		options: old.getCompilerOptions(),
		rootNames: old.getRootFileNames(),
	};
	if (projectReferences !== undefined) {
		programOptions.projectReferences = projectReferences;
	}

	// createProgram uses the host's resolution cache only when the host also
	// resolves modules. Otherwise each program makes a new cache and reads
	// each package.json again to find the module format of each file. This is
	// the default resolution of the compiler, with the shared cache. The cache
	// belongs to one parser program, so it holds at most the resolutions of
	// that program's files.
	if (RESOLVES_LITERALS) {
		host.resolveModuleNameLiterals = (
			...[literals, containingFile, redirectedReference, options, containingSourceFile]
		) => {
			const modeOptions = redirectedReference?.commandLine.options ?? options;
			const resolved = new Map<string, ts.ResolvedModuleWithFailedLookupLocations>();
			return literals.map((literal) => {
				const mode = ts.getModeForUsageLocation(containingSourceFile, literal, modeOptions);
				const key = `${mode ?? ""}|${literal.text}`;
				let resolution = resolved.get(key);
				if (resolution === undefined) {
					resolution = ts.resolveModuleName(
						literal.text,
						containingFile,
						options,
						host,
						moduleResolution,
						redirectedReference,
						mode,
					);
					resolved.set(key, resolution);
				}

				return resolution;
			});
		};
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

/**
 * Finds the node of a kind at a range. When nodes share the kind and range,
 * the last in pre-order matches. Only nodes whose full span holds the range
 * can match, so the search visits one path and not the whole file.
 * @param source - The edited file.
 * @param kind - The syntax kind to match.
 * @param start - The start position without leading trivia.
 * @param end - The position after the last character of the node.
 * @returns The matching node, if any.
 */
function findNode(
	source: ts.SourceFile,
	kind: ts.SyntaxKind,
	start: number,
	end: number,
): ts.Node | undefined {
	let found: ts.Node | undefined;
	function visit(node: ts.Node): void {
		if (node.kind === kind && node.end === end && node.getStart(source) === start) {
			found = node;
		}

		ts.forEachChild(node, (child) => {
			if (child.pos <= start && end <= child.end) {
				visit(child);
			}
		});
	}

	visit(source);
	return found;
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
 * Whether a node is a function body or a static block, which declaration
 * emit never prints. This mirrors the rule's `isEmitterBoundary`.
 * @param node - The node to inspect, below the source file.
 * @returns True when the node hides its contents from declaration emit.
 */
function isEmitterBoundary(node: ts.Node): boolean {
	const { parent } = node;
	return (
		ts.isClassStaticBlockDeclaration(node) ||
		(ts.isFunctionLike(parent) && "body" in parent && parent.body === node)
	);
}

/**
 * Whether declaration emit can print the candidate's type. Declarations in a
 * function body or a static block, and parameters of functions there, never
 * reach a `.d.ts`.
 * @param owner - The candidate's declaration.
 * @returns False when the owner is inside a function body or static block.
 */
function affectsDeclarationEmit(owner: Candidate["owner"]): boolean {
	for (let node: ts.Node = owner; !ts.isSourceFile(node.parent); node = node.parent) {
		if (isEmitterBoundary(node)) {
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
		const binding =
			owner.name ??
			(ts.isVariableDeclaration(owner.parent) || ts.isPropertyAssignment(owner.parent)
				? owner.parent.name
				: undefined);
		const symbol =
			binding !== undefined && ts.isIdentifier(binding)
				? checker.getSymbolAtLocation(binding)
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

/**
 * The statement, or expression body of an arrow function, containing a node.
 * @param node - A node in the file.
 * @returns The innermost enclosing statement or arrow body.
 */
function enclosingStatement(node: ts.Node): ts.Node {
	let current = node;
	while (
		!ts.isSourceFile(current.parent) &&
		(!ts.isStatement(current) || !ts.isBlock(current.parent)) &&
		(!ts.isArrowFunction(current.parent) || current.parent.body !== current)
	) {
		current = current.parent;
	}

	return current;
}

/**
 * The region a removal can influence. A parameter influences its function,
 * or, through generic inference, the call or element that receives it.
 * Object and array literals between them do not isolate the inference.
 * @param owner - The candidate's declaration.
 * @returns The node whose types the removal may change.
 */
function influenceScope(owner: Candidate["owner"]): ts.Node {
	if (
		ts.isVariableDeclaration(owner) ||
		ts.isFunctionDeclaration(owner) ||
		ts.isMethodDeclaration(owner)
	) {
		return enclosingStatement(owner);
	}

	let node: ts.Node = ts.isParameter(owner) ? owner.parent : owner;
	while (
		ts.isParenthesizedExpression(node.parent) ||
		ts.isPropertyAssignment(node.parent) ||
		ts.isObjectLiteralExpression(node.parent) ||
		ts.isArrayLiteralExpression(node.parent) ||
		ts.isSpreadElement(node.parent) ||
		ts.isJsxExpression(node.parent) ||
		ts.isJsxAttribute(node.parent) ||
		ts.isJsxAttributes(node.parent)
	) {
		node = node.parent;
	}

	const { parent } = node;
	if (
		ts.isCallExpression(parent) ||
		ts.isNewExpression(parent) ||
		ts.isJsxOpeningElement(parent) ||
		ts.isJsxSelfClosingElement(parent)
	) {
		return parent;
	}

	return owner.parent;
}

function contains(outer: ts.Node, inner: ts.Node): boolean {
	return outer.pos <= inner.pos && inner.end <= outer.end;
}

/**
 * Finds candidates whose removal may change another candidate's types: their
 * influence scopes overlap, or one statement uses both bindings. A use that
 * a `const` can narrow through its initializer counts as a use of it.
 * @template C - The rule's candidate, including its report metadata.
 * @param candidates - The candidates selected for verification.
 * @param references - The referencing identifiers of each candidate owner.
 * @param narrowed - The uses each candidate can narrow as an aliased
 *   condition.
 * @returns The removals coupled with each coupled candidate.
 */
function coupledCandidates<C extends Candidate>(
	candidates: ReadonlyArray<C>,
	references: ReadonlyMap<ts.Node, ReadonlyArray<ts.Identifier>>,
	narrowed: ReadonlyMap<C, ReadonlyArray<ts.Node>>,
): Map<C, Set<C>> {
	const scoped = candidates.map((candidate) => {
		return {
			candidate,
			scopes: [
				influenceScope(candidate.owner),
				...(references.get(candidate.owner) ?? []).map(enclosingStatement),
				...(narrowed.get(candidate) ?? []).map(enclosingStatement),
			],
		};
	});
	const coupled = new Map<C, Set<C>>();
	function link(from: C, to: C): void {
		const partners = coupled.get(from) ?? new Set<C>();
		partners.add(to);
		coupled.set(from, partners);
	}

	for (const [index, first] of scoped.entries()) {
		const later = scoped.slice(index + 1);
		for (const second of later) {
			const overlaps = first.scopes.some((outer) => {
				return second.scopes.some(
					(inner) => contains(outer, inner) || contains(inner, outer),
				);
			});
			if (overlaps) {
				link(first.candidate, second.candidate);
				link(second.candidate, first.candidate);
			}
		}
	}

	return coupled;
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

/**
 * Collects the expressions a function body returns, without entering nested
 * functions.
 * @param node - The body, or a node inside it.
 * @param found - Receives each returned expression.
 */
function collectReturns(node: ts.Node, found: Array<ts.Node>): void {
	if (ts.isFunctionLike(node)) {
		return;
	}

	if (ts.isReturnStatement(node) && node.expression !== undefined) {
		found.push(node.expression);
	}

	ts.forEachChild(node, (child) => {
		collectReturns(child, found);
	});
}

function skipParentheses(node: ts.Expression): ts.Expression {
	return ts.isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;
}

/**
 * Finds the call that receives the arrow or function expression whose
 * parameter a candidate annotates.
 *
 * Without the annotation, the callback can become context sensitive. Then
 * the call checks it after its other arguments, and a type parameter can be
 * fixed before the callback can infer it. So the call and its other
 * arguments are observed.
 *
 * Without the annotation, an arrow's signature also takes `this` from its
 * context, but an arrow never reads that `this`, so the call's arrow
 * arguments are compared without it. The call observes a `this` that
 * escapes.
 * @param owner - The candidate's owner.
 * @returns The call and its arrow arguments, or undefined.
 */
function receivingCall(owner: Candidate["owner"]): ReceivingCall | undefined {
	if (
		!ts.isParameter(owner) ||
		(!ts.isArrowFunction(owner.parent) && !ts.isFunctionExpression(owner.parent))
	) {
		return undefined;
	}

	let argument: ts.Expression = owner.parent;
	while (ts.isParenthesizedExpression(argument.parent)) {
		argument = argument.parent;
	}

	const call = argument.parent;
	if (
		(!ts.isCallExpression(call) && !ts.isNewExpression(call)) ||
		call.arguments?.includes(argument) !== true
	) {
		return undefined;
	}

	const arrows = new Set<ts.Node>(call.arguments.map(skipParentheses).filter(ts.isArrowFunction));
	return { arrows, call };
}

function observedNodes(
	candidate: Candidate,
	references: ReadonlyArray<ts.Identifier>,
	receiving: ReceivingCall | undefined,
): Array<ts.Node> {
	const nodes: Array<ts.Node> = [candidate.owner];
	if (ts.isParameter(candidate.owner)) {
		nodes.push(candidate.owner.parent);
	}

	// The call and its other arguments observe a type parameter that the
	// call fixes before the callback can infer it, and a `this` left out of
	// the arrows' types that escapes through inference, as in
	// `wrap<F>(callback: F): F`.
	if (receiving !== undefined) {
		const { call } = receiving;
		const self = candidate.owner.parent;
		nodes.push(
			call,
			...(call.arguments ?? []).map(skipParentheses).filter((node) => node !== self),
		);
	}

	// A use site's parent observes its contextual typing and overload choice,
	// as in `register(handler)` or `handler = (event) => event.detail`.
	for (const reference of references) {
		nodes.push(reference, reference.parent);
	}

	const { owner } = candidate;
	// A function's printed type is its whole signature. Its return values
	// lose the return type as their context, like an initializer loses the
	// variable's annotation.
	const roots: Array<ts.Node> = [];
	if (ts.isVariableDeclaration(owner) || ts.isParameter(owner)) {
		if (owner.initializer !== undefined) {
			roots.push(owner.initializer);
		}
	} else {
		if (ts.isVariableDeclaration(owner.parent)) {
			nodes.push(owner.parent);
		}

		if (owner.body !== undefined && ts.isBlock(owner.body)) {
			collectReturns(owner.body, roots);
		} else if (owner.body !== undefined) {
			roots.push(owner.body);
		}

		nodes.push(...roots);
	}

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

	for (const root of roots) {
		visit(root);
	}

	return nodes;
}

const EQUALITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
]);

const LOGICAL_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * Reports whether a reference can be a condition that TypeScript narrows
 * by: a test of a statement or a conditional, an operand of a logical
 * expression, a `switch` or `case` expression, a call argument (an
 * assertion), the initializer of another alias, or a returned value (an
 * inferred type predicate). The check looks through parentheses, type
 * assertions, `!`, and equality operators.
 * @param reference - A reference to the `const`.
 * @returns False only when the reference cannot narrow.
 */
function canActAsCondition(reference: ts.Node): boolean {
	let node = reference;
	let { parent } = node;
	while (
		ts.isParenthesizedExpression(parent) ||
		ts.isAssertionExpression(parent) ||
		// TypeScript 4.8 has no `isSatisfiesExpression`.
		parent.kind === ts.SyntaxKind.SatisfiesExpression ||
		ts.isNonNullExpression(parent) ||
		(ts.isPrefixUnaryExpression(parent) &&
			parent.operator === ts.SyntaxKind.ExclamationToken) ||
		(ts.isBinaryExpression(parent) && EQUALITY_OPERATORS.has(parent.operatorToken.kind))
	) {
		node = parent;
		({ parent } = node);
	}

	if (ts.isBinaryExpression(parent)) {
		return LOGICAL_OPERATORS.has(parent.operatorToken.kind);
	}

	if (
		ts.isIfStatement(parent) ||
		ts.isWhileStatement(parent) ||
		ts.isDoStatement(parent) ||
		ts.isSwitchStatement(parent) ||
		ts.isCaseClause(parent)
	) {
		return parent.expression === node;
	}

	if (ts.isForStatement(parent) || ts.isConditionalExpression(parent)) {
		return parent.condition === node;
	}

	// A `const` initialized with the reference aliases it in turn.
	return (
		ts.isCallExpression(parent) ||
		ts.isVariableDeclaration(parent) ||
		ts.isReturnStatement(parent) ||
		(ts.isArrowFunction(parent) && parent.body === node)
	);
}

/**
 * Finds the uses a `const` can narrow through its initializer. TypeScript
 * narrows an aliased condition, as in `const ok = typeof v === "string";
 * if (ok) v.length`, only when the `const` has no annotation. Removing the
 * annotation therefore changes the types of `v`, `this`, and property
 * accesses on them after the declaration, to the end of the enclosing
 * function or file.
 * @param checker - The original checker.
 * @param owner - The candidate's declaration.
 * @param references - The referencing identifiers of the owner.
 * @returns The narrowable references after the declaration, with their
 * property and element accesses.
 */
function aliasNarrowedNodes(
	checker: ts.TypeChecker,
	owner: Candidate["owner"],
	references: ReadonlyArray<ts.Identifier>,
): Array<ts.Node> {
	if (
		!ts.isVariableDeclaration(owner) ||
		owner.initializer === undefined ||
		(ts.getCombinedNodeFlags(owner) & (ts.NodeFlags.Const | ts.NodeFlags.Using)) === 0 ||
		!references.some(canActAsCondition)
	) {
		return [];
	}

	const symbols = new Set<ts.Symbol>();
	const names = new Set<string>();
	const thisReads: Array<ts.Node> = [];
	function collect(node: ts.Node): void {
		// A narrowing inside a nested function is not an alias.
		if (ts.isTypeNode(node) || ts.isFunctionLike(node)) {
			return;
		}

		if (node.kind === ts.SyntaxKind.ThisKeyword) {
			thisReads.push(node);
		} else if (
			ts.isIdentifier(node) &&
			(!ts.isPropertyAccessExpression(node.parent) || node.parent.name !== node)
		) {
			// Only a variable, a parameter, or an import is a narrowable
			// reference. A property access narrows through its object.
			const symbol = checker.getSymbolAtLocation(node);
			if (
				symbol !== undefined &&
				(symbol.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Alias)) !== 0
			) {
				symbols.add(symbol);
				names.add(node.text);
			}
		}

		ts.forEachChild(node, collect);
	}

	collect(owner.initializer);
	const readsThis = thisReads.length > 0;
	if (!readsThis && symbols.size === 0) {
		return [];
	}

	// The narrowing continues to the end of the flow container, also after
	// the block or `for` statement that scopes the `const`.
	const scope =
		ts.findAncestor(owner.parent, (node) => {
			return (
				ts.isFunctionLike(node) ||
				ts.isClassStaticBlockDeclaration(node) ||
				ts.isSourceFile(node)
			);
		}) ?? owner.getSourceFile();
	const nodes: Array<ts.Node> = [];
	function observe(node: ts.Node): void {
		let current = node;
		nodes.push(current);
		while (
			(ts.isPropertyAccessExpression(current.parent) ||
				ts.isElementAccessExpression(current.parent)) &&
			current.parent.expression === current
		) {
			current = current.parent;
			nodes.push(current);
		}
	}

	function visit(node: ts.Node): void {
		if (ts.isTypeNode(node) || node.end <= owner.end) {
			return;
		}

		if (node.pos >= owner.end) {
			if (readsThis && node.kind === ts.SyntaxKind.ThisKeyword) {
				observe(node);
			} else if (ts.isIdentifier(node) && names.has(node.text)) {
				const symbol = checker.getSymbolAtLocation(node);
				if (symbol !== undefined && symbols.has(symbol)) {
					observe(
						ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
							? node.parent
							: node,
					);
				}
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(scope);
	return nodes;
}

/**
 * Drops the `this` parameter from a function type.
 * @param factory - The node factory.
 * @param node - The type node.
 * @returns The function type without `this`, or the node unchanged.
 */
function withoutThis(factory: ts.NodeFactory, node: ts.TypeNode): ts.TypeNode {
	if (!ts.isFunctionTypeNode(node)) {
		return node;
	}

	const [first] = node.parameters;
	if (first === undefined || !ts.isIdentifier(first.name) || first.name.text !== "this") {
		return node;
	}

	return factory.updateFunctionTypeNode(
		node,
		node.typeParameters,
		factory.createNodeArray(node.parameters.slice(1)),
		node.type,
	);
}

function declarations(
	checker: ts.TypeChecker,
	type: ts.Type,
	locate: (declaration: ts.Node) => string,
	omitThis: boolean,
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
		visit(omitThis ? withoutThis(ts.factory, node) : node);
	}

	return [...keys].sort().join(", ");
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
	omitThis?: boolean,
) => string {
	const cache = new Map<string, string>();
	const printer = ts.createPrinter({ removeComments: true });
	return (checker, node, locate, omitThis = false) => {
		const target =
			ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)
				? node.name
				: node;
		const type = checker.getTypeAtLocation(target);
		const text = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
		const suffix = ` [${declarations(checker, type, locate, omitThis)}]`;
		const key = omitThis ? `omit-this ${text}` : text;
		const cached = cache.get(key);
		if (cached !== undefined) {
			return cached + suffix;
		}

		const source = ts.createSourceFile(
			"type.ts",
			`type Result = ${text};`,
			ts.ScriptTarget.Latest,
			true,
		);
		function byText(a: ts.Node, b: ts.Node): number {
			const left = printer.printNode(ts.EmitHint.Unspecified, a, source);
			const right = printer.printNode(ts.EmitHint.Unspecified, b, source);
			if (left === right) {
				return 0;
			}

			return left < right ? -1 : 1;
		}

		const transformed = ts.transform(source, [
			(context) => {
				function visit(original: ts.Node): ts.Node {
					const updated = ts.visitEachChild(original, visit, context);
					if (
						ts.isTypeLiteralNode(updated) &&
						updated.members.every(ts.isPropertySignature)
					) {
						return context.factory.updateTypeLiteralNode(
							updated,
							context.factory.createNodeArray([...updated.members].sort(byText)),
						);
					}

					// A checker orders union members by type creation, which
					// depends on its query history. The order carries no meaning.
					if (ts.isUnionTypeNode(updated)) {
						return context.factory.updateUnionTypeNode(
							updated,
							context.factory.createNodeArray([...updated.types].sort(byText)),
						);
					}

					return updated;
				}

				return (root) => {
					const [alias] = root.statements;
					const stripped =
						omitThis && alias !== undefined && ts.isTypeAliasDeclaration(alias)
							? context.factory.updateSourceFile(root, [
									context.factory.updateTypeAliasDeclaration(
										alias,
										alias.modifiers,
										alias.name,
										alias.typeParameters,
										withoutThis(context.factory, alias.type),
									),
								])
							: root;
					return ts.visitNode(stripped, visit, ts.isSourceFile);
				};
			},
		]);
		try {
			const [resultFile] = transformed.transformed;
			if (resultFile === undefined) {
				throw new Error("The type printer produced no output");
			}

			const result = printer.printFile(resultFile).trim();
			cache.set(key, result);
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
