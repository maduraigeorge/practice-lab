// Unit tests for the ER model built from a relational schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildER } from '../../assets/js/sql-er.js';

const col = (name, pk = false) => ({ name, type: 'INTEGER', pk });
const schema = {
  tables: [
    { name: 'customers', columns: [col('id', true), col('name')] },
    { name: 'orders', columns: [col('id', true), col('customer_id')] },
    { name: 'products', columns: [col('id', true)] },
    { name: 'order_items', columns: [col('order_id', true), col('product_id', true), col('quantity')] },
    { name: 'profiles', columns: [col('customer_id', true), col('bio')] },
    { name: 'v_sales', view: true, columns: [col('x')] },
  ],
  fks: [
    { from: ['orders', 'customer_id'], to: ['customers', 'id'] },
    { from: ['order_items', 'order_id'], to: ['orders', 'id'] },
    { from: ['order_items', 'product_id'], to: ['products', 'id'] },
    { from: ['profiles', 'customer_id'], to: ['customers', 'id'] },
  ],
};

test('a foreign key becomes a 1 : N relationship', () => {
  const { rels } = buildER(schema), r = rels.find(x => x.label === 'customer_id');
  assert.deepEqual(r.parts, [{ entity: 'customers', card: '1' }, { entity: 'orders', card: 'N' }]);
});

test('a foreign key that is the whole primary key is 1 : 1', () => {
  const r = buildER(schema).rels.find(x => x.parts[1].entity === 'profiles');
  assert.equal(r.parts[1].card, '1');
});

test('a link table becomes one N : N relationship that keeps its own columns as attributes', () => {
  const { entities, rels } = buildER(schema), j = rels.find(x => x.junction === 'order_items');
  assert.ok(!entities.some(e => e.name === 'order_items'));
  assert.deepEqual(j.parts.map(p => p.entity).sort(), ['orders', 'products']);
  assert.deepEqual(j.attrs, ['quantity']);
});

test('views are not entities and entities flag their key columns', () => {
  const { entities } = buildER(schema);
  assert.ok(!entities.some(e => e.name === 'v_sales'));
  const o = entities.find(e => e.name === 'orders');
  assert.ok(o.columns.find(c => c.name === 'id').pk && o.columns.find(c => c.name === 'customer_id').fk);
});
