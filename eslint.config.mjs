import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.stylisticTypeChecked,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: true
      },
    },
  },
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-nested-ternary": "error"
    }
  },
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-nested-ternary": "error",
      "require-jsdoc": ["error", {
        "require": {
          "FunctionDeclaration": true,
          "MethodDefinition": false,
          "ClassDeclaration": false,
          "ArrowFunctionExpression": false,
          "FunctionExpression": false
        }
      }]
    }
  },
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "claude_temp/",
      "claude_tmp/",
      "eslint.config.mjs",
      "prisma.config.ts",
      "vitest.config.ts"
    ],
  }
);
