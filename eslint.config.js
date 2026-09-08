import js from "@eslint/js";
import globals from "globals";

/** Resolve a directly named function without confusing shadowed identifiers. */
function calledFunction(source, node) {
  if (node.callee.type !== "Identifier") return null;
  for (let scope = source.getScope(node); scope; scope = scope.upper) {
    const binding = scope.set.get(node.callee.name);
    if (!binding) continue;
    for (const definition of binding.defs) {
      if (definition.type === "FunctionName") return definition.node;
      const initializer = definition.node.init;
      if (initializer?.type === "ArrowFunctionExpression") return initializer;
      if (initializer?.type === "FunctionExpression") return initializer;
    }
    return null;
  }
  return null;
}

/** File-local call graph; cross-module/callback cycles also require review. */
function reportCycles(context, graph) {
  for (const origin of graph.keys()) {
    const pending = [origin];
    const visited = new Set(pending);
    for (let index = 0; index < pending.length; index++) {
      for (const target of graph.get(pending[index]) ?? []) {
        if (target === origin) {
          context.report({ node: origin, messageId: "recursion" });
          index = pending.length;
          break;
        }
        if (!visited.has(target)) {
          visited.add(target);
          pending.push(target);
        }
      }
    }
  }
}

const noRecursion = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      recursion: "Synchronous recursion violates docs/coding-style.md.",
    },
  },
  create(context) {
    const graph = new Map();
    const stack = [];
    return {
      ":function"(node) {
        graph.set(node, new Set());
        stack.push(node);
      },
      ":function:exit"() {
        stack.pop();
      },
      CallExpression(node) {
        const target = calledFunction(context.sourceCode, node);
        if (target && stack.length) graph.get(stack.at(-1)).add(target);
      },
      "Program:exit"() {
        reportCycles(context, graph);
      },
    };
  },
};

export default [
  {
    ignores: [
      "node_modules/**",
      "client/dist/**",
      "client/public/generated/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, Bun: "readonly" },
    },
    plugins: { maple: { rules: { "no-recursion": noRecursion } } },
    rules: {
      "maple/no-recursion": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      curly: ["error", "multi-line"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-labels": "error",
      "no-loop-func": "error",
      "no-prototype-builtins": "error",
      "no-throw-literal": "error",
      "no-promise-executor-return": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "max-lines-per-function": [
        "error",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
      complexity: ["error", 12],
    },
  },
];
