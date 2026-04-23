import { cookies } from "next/headers";

export type Theme = "light" | "dark";

export async function readThemeCookie(): Promise<Theme> {
  const store = await cookies();
  const value = store.get("mc-theme")?.value;
  return value === "light" ? "light" : "dark";
}
