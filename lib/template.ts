// templatePaths.ts
export const templatePaths = {
    REACT: 'react-ts',
    NEXTJS: 'nextjs-new',
    EXPRESS: 'express-simple',
    VUE: 'vue',
    HONO: 'hono-nodejs-starter',
    ANGULAR: 'angular',
  } as const;

export type TemplateKey = keyof typeof templatePaths;
  
