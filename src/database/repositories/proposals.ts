import { query } from '../client';

export interface Proposal {
  id: string;
  title: string;
  status: 'draft' | 'discussing' | 'approved' | 'rejected' | 'implemented';
  instruction_file: string | null;
  reasoning: string | null;
  conversation_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProposalInput {
  title: string;
  status?: 'draft' | 'discussing' | 'approved' | 'rejected' | 'implemented';
  instruction_file?: string;
  reasoning?: string;
  conversation_id?: string;
}

export interface UpdateProposalInput {
  title?: string;
  status?: 'draft' | 'discussing' | 'approved' | 'rejected' | 'implemented';
  instruction_file?: string;
  reasoning?: string;
  conversation_id?: string;
}

/**
 * Create a new proposal
 */
export async function create(input: CreateProposalInput): Promise<Proposal> {
  const fields: string[] = ['title'];
  const values: any[] = [input.title];
  const placeholders: string[] = ['$1'];
  let paramIndex = 2;

  if (input.status) {
    fields.push('status');
    values.push(input.status);
    placeholders.push(`$${paramIndex++}`);
  }

  if (input.instruction_file) {
    fields.push('instruction_file');
    values.push(input.instruction_file);
    placeholders.push(`$${paramIndex++}`);
  }

  if (input.reasoning) {
    fields.push('reasoning');
    values.push(input.reasoning);
    placeholders.push(`$${paramIndex++}`);
  }

  if (input.conversation_id) {
    fields.push('conversation_id');
    values.push(input.conversation_id);
    placeholders.push(`$${paramIndex++}`);
  }

  const result = await query<Proposal>(
    `INSERT INTO proposals (${fields.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Get proposal by ID
 */
export async function getById(id: string): Promise<Proposal | null> {
  const result = await query<Proposal>('SELECT * FROM proposals WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Get all proposals
 */
export async function getAll(limit = 50, offset = 0): Promise<Proposal[]> {
  const result = await query<Proposal>(
    'SELECT * FROM proposals ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return result.rows;
}

/**
 * Get active proposals (not rejected or implemented)
 */
export async function getActive(): Promise<Proposal[]> {
  const result = await query<Proposal>(
    `SELECT * FROM proposals 
     WHERE status NOT IN ('rejected', 'implemented') 
     ORDER BY created_at DESC`
  );
  return result.rows;
}

/**
 * Update proposal
 */
export async function update(id: string, input: UpdateProposalInput): Promise<Proposal | null> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    values.push(input.title);
  }

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }

  if (input.instruction_file !== undefined) {
    updates.push(`instruction_file = $${paramIndex++}`);
    values.push(input.instruction_file);
  }

  if (input.reasoning !== undefined) {
    updates.push(`reasoning = $${paramIndex++}`);
    values.push(input.reasoning);
  }

  if (input.conversation_id !== undefined) {
    updates.push(`conversation_id = $${paramIndex++}`);
    values.push(input.conversation_id);
  }

  if (updates.length === 0) {
    return getById(id);
  }

  values.push(id);
  const result = await query<Proposal>(
    `UPDATE proposals 
     SET ${updates.join(', ')} 
     WHERE id = $${paramIndex} 
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

/**
 * Delete proposal
 */
export async function remove(id: string): Promise<boolean> {
  const result = await query('DELETE FROM proposals WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}
