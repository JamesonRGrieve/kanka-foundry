/// <reference types="vite/client" />

declare module '*.hbs' {
    export = string;
}

type ConstructorOf<C> = { new (...args: unknown[]): C };

type PickWithPrefix<T, Prefix extends string> = {
    [K in keyof T as K extends `${Prefix}${string}` ? K : never]: T[K];
};

type StripPrefix<T, Prefix extends string> = {
    [K in keyof T as K extends `${Prefix}${infer Rest}` ? Rest : never]: T[K];
};
