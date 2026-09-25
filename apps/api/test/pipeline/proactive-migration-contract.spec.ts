import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

describe('proactive delivery migration SQL contract', () => {
  it.each([
    '20260921100000_add_proactive_thesis_run_identity',
    '20260921110000_add_proactive_delivery_state',
    '20260921120000_add_proactive_delivery_lease',
    '20260921130000_fence_proactive_delivery_and_execution',
  ])('%s alters the table mapped by Prisma', (migration) => {
    const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === 'PipelineRun')!;
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations', migration, 'migration.sql'), 'utf8');
    // Compare independently authored migration SQL against Prisma's actual DB
    // mapping. Schema validation alone never checks which table SQL will alter.
    const alteredTables = [...sql.matchAll(/\bALTER\s+TABLE\s+"([^"]+)"/gi)].map((match) => match[1]);
    expect(alteredTables).toEqual([model.dbName ?? model.name]);
    const addedColumns = [...sql.matchAll(/\bADD\s+COLUMN\s+"([^"]+)"/gi)].map((match) => match[1]);
    expect(addedColumns.length).toBeGreaterThan(0);
    const mappedFields = model.fields.map((field) => field.dbName ?? field.name);
    for (const column of addedColumns) expect(mappedFields).toContain(column);
  });
});
