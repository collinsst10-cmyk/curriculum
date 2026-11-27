'use strict';

window.BehaviorEngine = (() => {
  const { groups, records } = BehaviorData;
  const traits = new Map(groups.flatMap(group => group.traits.map(trait => [trait.id, trait])));
  const length = text => Array.from(text).length;
  const bytes = text => new TextEncoder().encode(text).length;
  const sentences = text => String(text || '').split(/(?<=[.!?。])\s*|\n+/).map(line => line.trim()).filter(Boolean);

  function starter(trait, status, band) {
    const { action, statement } = trait;
    const scene = band === '1-2' ? '교실 활동에서' : band === '3-4' ? '학교생활에서' : '학급 활동에서';
    const variants = {
      '': [statement, scene + ' ' + action + ' 모습이 나타남'],
      excellent: [action + ' 역량이 돋보임', scene + ' ' + action + ' 강점이 드러남'],
      stable: [action + ' 태도를 안정적으로 유지함', scene + ' ' + action + ' 모습을 꾸준히 보임'],
      forming: [action + ' 태도를 기르는 단계임', scene + ' ' + action + ' 습관을 형성해 가는 중임'],
      improved: [action + ' 모습이 이전보다 뚜렷해짐', scene + ' ' + action + ' 정도가 이전보다 향상됨'],
      guidance: [action + ' 연습이 지속적으로 필요함', scene + ' ' + action + ' 데 꾸준한 지도가 필요함'],
    };
    return (variants[status] || variants['']).map(text => text + '.');
  }

  function generate({ selected, grade, goal, peers = [], previous = '', variation = 0 }) {
    const band = grade <= 2 ? '1-2' : grade <= 4 ? '3-4' : '5-6';
    const used = new Set(peers.flatMap(sentences));
    const prior = new Set(sentences(previous));
    const buckets = new Map();
    for (const [id, status] of Object.entries(selected)) {
      const trait = traits.get(id);
      if (!trait) continue;
      const curated = records.filter(record => record.traitId === id &&
        record.status === status && (!record.bands || record.bands.includes(band)));
      const options = [...new Set([...curated.map(record => record.text), ...starter(trait, status, band)])];
      const bucket = buckets.get(trait.meaning) || [];
      options.forEach((text, index) => {
        if (bucket.some(option => option.text === text)) return;
        bucket.push({ text, cost: (used.has(text) ? 4 : 0) + (variation && prior.has(text) ? 6 : 0) +
          (index + variation) % options.length / 10 });
      });
      buckets.set(trait.meaning, bucket);
    }
    // 길이마다 비용이 낮은 조합을 기억합니다. 같은 의미 묶음에서는 한 문장만 씁니다.
    const cap = goal + 100;
    let best = new Map([[0, { parts: [], cost: 0 }]]);
    for (const options of buckets.values()) {
      const next = new Map(best);
      for (const [size, choice] of best) for (const option of options) {
        const total = size + length(option.text) + Number(size > 0);
        if (total > cap) continue;
        const lastEnding = choice.parts.at(-1)?.slice(-3);
        const cost = choice.cost + option.cost + (lastEnding === option.text.slice(-3) ? 1 : 0);
        if (cost < (next.get(total)?.cost ?? Infinity)) next.set(total, { parts: [...choice.parts, option.text], cost });
      }
      best = next;
    }
    const score = ([size, choice]) => Math.abs(goal - size) + (size > goal ? 1 : 0) + choice.cost;
    return [...best].filter(([size]) => size > 0).sort((a, b) => score(a) - score(b))[0]?.[1].parts.join(' ') || '';
  }

  return { length, bytes, generate };
})();
