import { createFlawlessRule } from "../../util";
import { createUnnecessaryHookRule } from "../../utils/unnecessary-hook";

export const RULE_NAME = "no-unnecessary-use-callback";

const MESSAGE_ID_DEFAULT = "default";
const MESSAGE_ID_INSIDE_USE_EFFECT = "noUnnecessaryUseCallbackInsideUseEffect";

export type MessageIds = typeof MESSAGE_ID_DEFAULT | typeof MESSAGE_ID_INSIDE_USE_EFFECT;

export type Options = [];

const messages = {
	[MESSAGE_ID_DEFAULT]:
		"An 'useCallback' with empty deps and no references to the component scope may be unnecessary.",
	[MESSAGE_ID_INSIDE_USE_EFFECT]:
		"'{{name}}' is only used inside 1 useEffect, which may be unnecessary. You can move the computation into useEffect directly and merge the dependency arrays.",
};

const createOnce = createUnnecessaryHookRule<MessageIds>({
	hook: "useCallback",
	messageIds: {
		default: MESSAGE_ID_DEFAULT,
		insideUseEffect: MESSAGE_ID_INSIDE_USE_EFFECT,
	},
});

export const noUnnecessaryUseCallback = createFlawlessRule<Options, MessageIds>({
	name: RULE_NAME,
	createOnce,
	defaultOptions: [],
	meta: {
		docs: {
			description: "Disallow unnecessary usage of 'useCallback'",
			recommended: false,
			requiresTypeChecking: false,
		},
		hasSuggestions: false,
		messages,
		schema: [],
		type: "suggestion",
	},
});
