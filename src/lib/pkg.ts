import pkg from "../../package.json" with { type: "json" };

export const PKG_NAME: string = pkg.name;
export const PKG_VERSION: string = pkg.version;
