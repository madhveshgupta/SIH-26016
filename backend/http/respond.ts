/** NextResponse.json, with the body's messages in the viewer's language. */
import { NextResponse } from "next/server";
import { getTranslator } from "@backend/i18n/locale";
import { translateBody } from "@backend/i18n/api-text";

export async function apiJson<T>(body: T, init?: ResponseInit): Promise<NextResponse<T>> {
  const { t } = await getTranslator();
  return NextResponse.json(translateBody(body, t), init);
}
