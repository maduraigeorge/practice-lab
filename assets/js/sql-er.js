/* ER model from a relational schema (pure functions, unit-tested under tests/js).
 *
 * buildER(schema) -> { entities, rels }
 *   entities: [{ name, columns: [{ name, type, pk, fk }] }]            every table that is not a view or a pure link table
 *   rels:     [{ id, label, parts: [{ entity, card: '1' | 'N' }], attrs: [column names], junction: table name | null }]
 *
 * - a foreign key child.col -> parent.pk becomes a 1 : N relationship (1 : 1 when the FK columns are the child's whole primary key)
 * - a link table (primary key made only of foreign keys, 2+ of them, nothing points at it) becomes one many-to-many relationship
 *   between the tables it links; its other columns become attributes of that relationship. */
export function buildER(schema) {
  const tables = (schema.tables || []).filter(t => !t.view), byName = new Map(tables.map(t => [t.name, t]));
  const groups = new Map();                                                    // one group per (child table, parent table) pair: composite keys stay together
  for (const f of schema.fks || []) {
    if (!byName.has(f.from[0]) || !byName.has(f.to[0])) continue;
    const k = f.from[0] + '\u0000' + f.to[0];
    if (!groups.has(k)) groups.set(k, { child: f.from[0], parent: f.to[0], cols: [] });
    groups.get(k).cols.push(f.from[1]);
  }
  const byChild = new Map(), referenced = new Set();
  for (const g of groups.values()) { if (!byChild.has(g.child)) byChild.set(g.child, []); byChild.get(g.child).push(g); if (g.parent !== g.child) referenced.add(g.parent); }

  const entities = [], rels = [], junctions = new Set();
  for (const t of tables) {
    const gs = byChild.get(t.name) || [], fkCols = new Set(gs.flatMap(g => g.cols)), pk = t.columns.filter(c => c.pk).map(c => c.name);
    if (gs.length >= 2 && pk.length >= 2 && pk.every(c => fkCols.has(c)) && !referenced.has(t.name)) junctions.add(t.name);
  }
  for (const t of tables) {
    const gs = byChild.get(t.name) || [], fkCols = new Set(gs.flatMap(g => g.cols));
    if (junctions.has(t.name)) {
      rels.push({ id: 'j:' + t.name, label: t.name, junction: t.name, parts: gs.map(g => ({ entity: g.parent, card: 'N' })), attrs: t.columns.filter(c => !fkCols.has(c.name)).map(c => c.name) });
      continue;
    }
    entities.push({ name: t.name, columns: t.columns.map(c => ({ name: c.name, type: c.type || '', pk: !!c.pk, fk: fkCols.has(c.name) })) });
  }
  for (const g of groups.values()) {
    if (junctions.has(g.child)) continue;
    const pk = byName.get(g.child).columns.filter(c => c.pk).map(c => c.name), one = pk.length === g.cols.length && g.cols.every(c => pk.includes(c));
    rels.push({ id: `${g.child}.${g.cols.join(',')}`, label: g.cols.join(', '), junction: null, attrs: [], parts: [{ entity: g.parent, card: '1' }, { entity: g.child, card: one ? '1' : 'N' }] });
  }
  return { entities, rels };
}
