declare const target: object;
declare const value: unknown;
declare const key: string;

Reflect.set(target, "_timing", true);
Reflect.set(target, "projects", value);
Reflect.set(target, 0, value);
Reflect.set(target, key, value);
