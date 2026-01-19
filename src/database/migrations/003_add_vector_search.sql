-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to knowledge_base table
ALTER TABLE knowledge_base ADD COLUMN embedding vector(1536);

-- Create HNSW index for fast similarity search
CREATE INDEX ON knowledge_base USING hnsw (embedding vector_cosine_ops);
