import type { Node } from "@/platform/fs";
import type { View } from "@/platform/load";

export type Tab = { node: Node; view: View; info: string; text: string; saved: string; eol: "lf" | "crlf" };
