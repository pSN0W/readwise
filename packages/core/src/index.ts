// @rh/core — shared read/write logic for the web and mobile apps.
// Contract: docs/contract/README.md. Nothing in here touches the DOM or a platform API;
// a UI provides a LibraryFS and renders what these functions return.
export * from "./types.ts";
export * from "./fs.ts";
export * from "./locate.ts";
export * from "./library.ts";
export * from "./state.ts";
export * from "./features.ts";
