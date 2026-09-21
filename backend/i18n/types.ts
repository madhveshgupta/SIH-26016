/** The dictionary shape, derived from English. */
import type en from "./locales/en";

/** The same shape as the English dictionary, but any string may fill a slot. */
export type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
export type Dictionary = Strings<typeof en>;

/** A dot path into the dictionary, e.g. "myLand.title". */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Dictionary>;
