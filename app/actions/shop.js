'use server';
/** Shop: buy cosmetics with coins, equip what you own or have unlocked. The buyer always comes from the session. */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/viewer';
import { buyItem, equipItem } from '@/lib/db/cosmetics';
import { createLimiter } from '@/lib/rate-limit';

const g = globalThis;
const limit = g.__taashShopLimiter || (g.__taashShopLimiter = createLimiter({ capacity: 20, perSecond: 1 }));
const Item = z.string().min(3).max(60);

export async function buyItemAction(itemId) {
  const me = await requireUser();
  if (!me) return { error: 'Sign in to use the shop.' };
  if (!limit(me.userId)) return { error: 'You’re going a little fast. Wait a moment.' };
  const id = Item.safeParse(itemId);
  if (!id.success) return { error: 'That item doesn’t exist.' };
  const r = await buyItem(me.userId, id.data);
  if (r.ok) revalidatePath('/shop');
  return r;
}

export async function equipItemAction(itemId) {
  const me = await requireUser();
  if (!me) return { error: 'Sign in to use the shop.' };
  if (!limit(me.userId)) return { error: 'You’re going a little fast. Wait a moment.' };
  const id = Item.safeParse(itemId);
  if (!id.success) return { error: 'That item doesn’t exist.' };
  const r = await equipItem(me.userId, id.data);
  if (r.ok) revalidatePath('/shop');
  return r;
}
