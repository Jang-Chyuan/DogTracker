import { t } from '../../i18n';
/** Compact H7 capsule and immediate dog chooser, with stable selection order. */
export function historyDogsPill(dogs = [], candidates = [], subject = 'dog') {
  if (subject === 'phone') return { name: t('c132'), tappable: false, label: t('c132'), faces: [], more: 0 };
  const lead = dogs.find(dog => dog.protagonist) ?? dogs[0];
  const others = dogs.filter(dog => dog.id !== lead?.id);
  const addable = candidates.some(dog => !dogs.some(shown => shown.id === dog.id));
  const tappable = others.length > 0 || addable;
  const name = lead?.name ?? '';
  return { lead, name, faces: others.slice(0, 2), more: Math.max(0, others.length - 2),
    plus: !others.length && addable, caret: others.length > 0, tappable,
    label: others.length ? t('c399', { dogName: name, count: others.length })
      : addable ? t("c695", { name: name }) : name };
}

export function historyDogsSheet(dogs = [], candidates = [], days = {}) {
  const full = dogs.length >= 4;
  return { full, note: full ? t('c326', { count: 4 }) : null,
    // The protagonist first (H7b), the others in the order they were added.
    shown: [...dogs].sort((a, b) => Number(!!b.protagonist) - Number(!!a.protagonist))
      .map(dog => ({ ...dog, removable: !dog.protagonist })),
    addable: candidates.filter(dog => !dogs.some(shown => shown.id === dog.id))
      .sort((a, b) => Number(a.id) - Number(b.id)).map(dog => ({ ...dog,
        hasData: days[dog.id] !== false, disabled: full,
        opacity: full || days[dog.id] === false ? 0.4 : 1,
        detail: days[dog.id] === false ? t('c327') : t('c052', { number: dog.id }) })) };
}

/** A dog without a photo is drawn in its route colour, like its face on the history map. */
export function routeTint(dog, colors) {
  return dog?.avatar || !dog?.color ? null : { bg: dog.color, line: colors.onRoute };
}
