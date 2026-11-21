import { APP_NAME } from "./app-brand";

export function brandShareText(text: string) {
  return text ? `${text}\n\n${APP_NAME}` : "";
}
