/** Compact H7 capsule and immediate dog chooser, with stable selection order. */
export function historyDogsPill(dogs = [], candidates = [], subject = 'dog') {
  if (subject === 'phone') return { name: '我的路線', tappable: false, label: '我的路線', faces: [], more: 0 };
  const lead = dogs.find(dog => dog.protagonist) ?? dogs[0];
  const others = dogs.filter(dog => dog.id !== lead?.id);
  const addable = candidates.some(dog => !dogs.some(shown => shown.id === dog.id));
  const tappable = others.length > 0 || addable;
  const name = lead?.name ?? '';
  return { lead, name, faces: others.slice(0, 2), more: Math.max(0, others.length - 2),
    plus: !others.length && addable, caret: others.length > 0, tappable,
    label: others.length ? `${name}，主角，另外 ${others.length} 隻，點兩下選擇要看的狗`
      : addable ? `${name}，點兩下加入其他狗` : name };
}

export function historyDogsSheet(dogs = [], candidates = [], days = {}) {
  const full = dogs.length >= 4;
  return { full, note: full ? '最多同時 4 隻' : null,
    // The protagonist first (H7b), the others in the order they were added.
    shown: [...dogs].sort((a, b) => Number(!!b.protagonist) - Number(!!a.protagonist))
      .map(dog => ({ ...dog, removable: !dog.protagonist })),
    addable: candidates.filter(dog => !dogs.some(shown => shown.id === dog.id))
      .sort((a, b) => Number(a.id) - Number(b.id)).map(dog => ({ ...dog,
        hasData: days[dog.id] !== false, disabled: full,
        opacity: full || days[dog.id] === false ? 0.4 : 1,
        detail: days[dog.id] === false ? '這天沒有紀錄' : `訊號源 ${dog.id}` })) };
}

/** A dog without a photo is drawn in its route colour, like its face on the history map. */
export function routeTint(dog, colors) {
  return dog?.avatar || !dog?.color ? null : { bg: dog.color, line: colors.onRoute };
}
