import eslint from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      ...prettierConfig.rules,
      "prettier/prettier": "error",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "warn",
    },
  },
  {
    // Build and scaffold scripts are expected to talk to the terminal.
    files: ["tools/**/*.ts", "**/*.config.ts", "**/*.config.js"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.test.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**"])
);
