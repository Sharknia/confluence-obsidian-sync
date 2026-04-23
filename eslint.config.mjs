import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked
  },
  {
    ignores: ["dist/**", "dist-types/**", "node_modules/**", "vault-template/.obsidian/plugins/confluence-obsidian-sync/**"]
  }
);
