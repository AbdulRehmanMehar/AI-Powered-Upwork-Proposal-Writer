import { QdrantClient } from '@qdrant/js-client-rest';

// Qdrant client singleton
let qdrantClient: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!qdrantClient) {
    const url = process.env.QDRANT_CONTAINER_URL;
    const apiKey = process.env.QDRANT_API_KEY;

    if (!url) {
      throw new Error('QDRANT_CONTAINER_URL environment variable is not set');
    }

    qdrantClient = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });
  }

  return qdrantClient;
}

// Collection names
export const COLLECTIONS = {
  PRACTITIONER_KNOWLEDGE: 'practitioner_knowledge',
  SUCCESSFUL_PROPOSALS: 'successful_proposals',
  USER_PROFILES: 'user_profiles', // User profile embeddings (projects, achievements, etc.)
} as const;

// Vector dimensions for Gemini embeddings (gemini-embedding-001)
export const VECTOR_DIMENSION = 768;

// Initialize collections if they don't exist
export async function initializeCollections(): Promise<void> {
  const client = getQdrantClient();

  for (const collectionName of Object.values(COLLECTIONS)) {
    try {
      const exists = await client.collectionExists(collectionName);
      
      if (!exists.exists) {
        await client.createCollection(collectionName, {
          vectors: {
            size: VECTOR_DIMENSION,
            distance: 'Cosine',
          },
        });
        console.log(`✅ Created collection: ${collectionName}`);
      } else {
        console.log(`✓ Collection exists: ${collectionName}`);
      }
    } catch (error) {
      console.error(`Error with collection ${collectionName}:`, error);
      throw error;
    }
  }
}

// Health check
export async function checkQdrantHealth(): Promise<boolean> {
  try {
    const client = getQdrantClient();
    await client.getCollections();
    return true;
  } catch (error) {
    console.error('Qdrant health check failed:', error);
    return false;
  }
}
