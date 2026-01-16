import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';
import { query } from '../../database/client';

const logger = createModuleLogger('context-loader');

export interface LoadedContextFile {
  filename: string;
  category: string;
  content: string;
  loadedAt: Date;
}

export interface LoadContextResult {
  loaded: number;
  skipped: number;
  errors: string[];
  files: LoadedContextFile[];
}

/**
 * Context Loader - загружает .md файлы из папки context/ в базу знаний
 * 
 * Файлы хранятся как файлы на диске (для удобства редактирования),
 * но при загрузке парсятся и сохраняются в таблицу knowledge_base
 * с source='initial_context' для использования AI.
 */
export class ContextLoader {
  private contextPath: string;

  constructor(contextPath?: string) {
    this.contextPath = contextPath || path.join(process.cwd(), 'context');
  }

  /**
   * Load all context files from the context directory
   */
  async loadAllContext(): Promise<LoadContextResult> {
    logger.info('Loading all context files', { path: this.contextPath });

    const result: LoadContextResult = {
      loaded: 0,
      skipped: 0,
      errors: [],
      files: [],
    };

    // Check if context directory exists
    if (!fs.existsSync(this.contextPath)) {
      logger.warn('Context directory does not exist', { path: this.contextPath });
      result.errors.push(`Context directory not found: ${this.contextPath}`);
      return result;
    }

    // Load goals.md if exists
    const goalsPath = path.join(this.contextPath, 'goals.md');
    if (fs.existsSync(goalsPath)) {
      await this.loadFile(goalsPath, 'goals', result);
    }

    // Load files from subdirectories
    const categories = ['campaigns', 'experiments', 'learnings'];
    for (const category of categories) {
      const categoryPath = path.join(this.contextPath, category);
      if (fs.existsSync(categoryPath)) {
        await this.loadDirectory(categoryPath, category, result);
      }
    }

    logger.info('Context loading completed', {
      loaded: result.loaded,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Load context files from a specific category
   */
  async loadCategory(category: string): Promise<LoadContextResult> {
    logger.info('Loading context category', { category });

    const result: LoadContextResult = {
      loaded: 0,
      skipped: 0,
      errors: [],
      files: [],
    };

    if (category === 'goals') {
      const goalsPath = path.join(this.contextPath, 'goals.md');
      if (fs.existsSync(goalsPath)) {
        await this.loadFile(goalsPath, 'goals', result);
      } else {
        result.errors.push('goals.md not found');
      }
    } else {
      const categoryPath = path.join(this.contextPath, category);
      if (fs.existsSync(categoryPath)) {
        await this.loadDirectory(categoryPath, category, result);
      } else {
        result.errors.push(`Category directory not found: ${category}`);
      }
    }

    return result;
  }

  /**
   * Load all .md files from a directory
   */
  private async loadDirectory(
    dirPath: string,
    category: string,
    result: LoadContextResult
  ): Promise<void> {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      if (file.endsWith('.md') && file !== 'README.md') {
        const filePath = path.join(dirPath, file);
        await this.loadFile(filePath, category, result);
      }
    }
  }

  /**
   * Load a single .md file into the knowledge base
   */
  private async loadFile(
    filePath: string,
    category: string,
    result: LoadContextResult
  ): Promise<void> {
    const filename = path.basename(filePath);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse markdown to extract facts
      const facts = this.parseMarkdownToFacts(content, filename, category);

      // Save facts to knowledge_base
      for (const fact of facts) {
        await this.saveFact(fact, category, filename);
      }

      result.loaded++;
      result.files.push({
        filename,
        category,
        content: content.substring(0, 200) + '...',
        loadedAt: new Date(),
      });

      logger.debug('Loaded context file', { filename, category, facts: facts.length });
    } catch (error) {
      const errorMsg = `Failed to load ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      result.errors.push(errorMsg);
      result.skipped++;
      logger.error('Failed to load context file', { filename, error });
    }
  }

  /**
   * Parse markdown content into facts for the knowledge base
   */
  private parseMarkdownToFacts(content: string, filename: string, category: string): string[] {
    const facts: string[] = [];

    // Extract title
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : filename.replace('.md', '');

    // Split by sections (## headers)
    const sections = content.split(/^##\s+/m);

    for (const section of sections) {
      if (!section.trim()) continue;

      const lines = section.split('\n');
      const sectionTitle = lines[0]?.trim();
      const sectionContent = lines.slice(1).join('\n').trim();

      if (sectionContent) {
        // Create a fact from each section
        const fact = `[${category}/${title}] ${sectionTitle}: ${this.cleanMarkdown(sectionContent)}`;
        facts.push(fact);
      }
    }

    // If no sections found, use the whole content as one fact
    if (facts.length === 0 && content.trim()) {
      facts.push(`[${category}/${title}] ${this.cleanMarkdown(content)}`);
    }

    return facts;
  }

  /**
   * Clean markdown formatting for storage
   */
  private cleanMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.+?)\*/g, '$1') // Remove italic
      .replace(/`(.+?)`/g, '$1') // Remove code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
      .replace(/^[-*]\s+/gm, '• ') // Normalize lists
      .replace(/\n{3,}/g, '\n\n') // Normalize newlines
      .trim();
  }

  /**
   * Save a fact to the knowledge base
   */
  private async saveFact(fact: string, category: string, filename: string): Promise<void> {
    const source = `initial_context/${category}/${filename}`;

    // Check if fact already exists (by source and similar content)
    const existing = await query<{ id: string }>(
      `SELECT id FROM knowledge_base 
       WHERE source = $1 AND fact = $2`,
      [source, fact]
    );

    if (existing.rows.length > 0) {
      // Update existing fact
      await query(
        `UPDATE knowledge_base SET fact = $1, confidence = 1.0 WHERE id = $2`,
        [fact, existing.rows[0].id]
      );
    } else {
      // Insert new fact
      await query(
        `INSERT INTO knowledge_base (fact, source, confidence)
         VALUES ($1, $2, 1.0)`,
        [fact, source]
      );
    }
  }

  /**
   * Clear all initial context from knowledge base
   */
  async clearInitialContext(): Promise<number> {
    logger.info('Clearing initial context from knowledge base');

    const result = await query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM knowledge_base 
         WHERE source LIKE 'initial_context/%'
         RETURNING *
       )
       SELECT COUNT(*) as count FROM deleted`
    );

    const count = parseInt(result.rows[0]?.count || '0', 10);
    logger.info('Cleared initial context', { count });

    return count;
  }

  /**
   * Get list of available context files
   */
  getAvailableFiles(): { category: string; files: string[] }[] {
    const result: { category: string; files: string[] }[] = [];

    // Check goals.md
    const goalsPath = path.join(this.contextPath, 'goals.md');
    if (fs.existsSync(goalsPath)) {
      result.push({ category: 'goals', files: ['goals.md'] });
    }

    // Check subdirectories
    const categories = ['campaigns', 'experiments', 'learnings'];
    for (const category of categories) {
      const categoryPath = path.join(this.contextPath, category);
      if (fs.existsSync(categoryPath)) {
        const files = fs.readdirSync(categoryPath).filter(
          (f) => f.endsWith('.md') && f !== 'README.md'
        );
        if (files.length > 0) {
          result.push({ category, files });
        }
      }
    }

    return result;
  }
}

export default ContextLoader;
