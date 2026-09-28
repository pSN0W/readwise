import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "katex/dist/katex.min.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { onBackButton } from "./lib/platform.ts";

onBackButton();
mount(App, { target: document.getElementById("app") as HTMLElement });
