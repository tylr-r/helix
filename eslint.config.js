const js = require("@eslint/js");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const importPlugin = require("eslint-plugin-import");

module.exports = [
  {
    ignores: ["lib/**", "node_modules/**", "hide/**", "eslint.config.js"],
  },
  js.configs.recommended,
  importPlugin.flatConfigs.errors,
  importPlugin.flatConfigs.warnings,
  importPlugin.flatConfigs.typescript,
  ...tsPlugin.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    rules: {
      "import/no-unresolved": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
