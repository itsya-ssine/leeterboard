import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-control-regex": "off",
      "preserve-caught-error": "off"
    }
  },
  {
    ignores: [
      "dist/**",
      "server-dist/**",
      "coverage/**",
      "node_modules/**",
      "local.db*",
      "*.patch",
      "scripts/**",
      "tests/**"
    ]
  }
);
