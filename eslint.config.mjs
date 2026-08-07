import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "output/**",
    "starter-templates/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Monaco and WebContainer expose dynamic host objects that are not fully
      // representable in application types. Tighten these incrementally.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      // These React 19 compiler-oriented rules flag established synchronization
      // patterns in the current UI. They remain disabled until those components
      // are migrated during the editor/runtime refactor stages.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
  },
]);
