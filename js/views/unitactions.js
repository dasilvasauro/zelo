// O que acontece ao tocar numa embalagem ou soltá-la em outro lugar (estoque e detalhe do item).
import * as store from '../core/store.js';
import { prodOf } from '../core/domain.js';
import { openUnit, closeUnit, consumeUnit, undoConsume, moveUnits } from '../core/units.js';
import { fmtNum, unitLabel } from '../lib/util.js';
import { toast } from '../ui/ui.js';
import { haptic } from '../ui/haptics.js';
import { isInt } from './product.js';

export async function tapUnit(u) {
  const S = store.snapshot();
  const inv = S.invByPid.get(u.pid);
  const p = prodOf(u.pid, inv);
  const unit = inv?.unit || p.unit;
  const name = inv?.name || p.name;
  if (u.state !== 'open') {
    haptic('tap');
    const id = await openUnit(S, u);
    const moved = inv?.openPlace && inv.openPlace !== u.place ? ` e foi para ${inv.openPlace}` : '';
    toast(`${name}: aberto${moved}`, { action: 'Desfazer', onAction: () => (u.virtual ? store.remove(id) : closeUnit({ ...u, virtual: false })), ms: 2500 });
  } else {
    haptic('add');
    const undo = await consumeUnit(S, u);
    toast(`${name}: ${fmtNum(u.amount)} ${unitLabel(unit)} ${u.amount === 1 ? 'usado' : 'usados'}`, { action: 'Desfazer', onAction: () => undoConsume(undo) });
  }
}
export async function dropUnits(units, place) {
  const n = await moveUnits(store.snapshot(), units, place);
  if (!n) return;
  const S = store.snapshot();
  const inv = S.invByPid.get(units[0].pid);
  const name = inv?.name || prodOf(units[0].pid).name;
  const learned = units.every((u) => u.state === 'open') ? 'abertos' : units.every((u) => u.state !== 'open') ? 'novos' : '';
  toast(`${units.length > 1 ? `${units.length} × ` : ''}${name} → ${place}${learned ? `. Os ${learned} vão para lá.` : ''}`);
}

