
# JSON Database Library Documentation

## Table of Contents
1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Core Concepts](#core-concepts)
4. [Entities](#entities)
5. [Querying](#querying)
6. [Indexing](#indexing)
7. [API Reference](#api-reference)
8. [Examples](#examples)

## Installation

```bash
bun add json-db-lite
```

## Quick Start

```typescript
import { JsonDB, BaseEntity, Entity, Column } from 'json-db-lite';

// Define an entity
@Entity('users')
class User extends BaseEntity {
  @Column({ type: 'number', primary: true })
  id: number;

  @Column({ type: 'string', unique: true, index: true })
  email: string;

  @Column({ type: 'string' })
  name: string;
}

// Initialize database
const db = new JsonDB('database.json');
BaseEntity.setDatabase(db);

// Use the entity
async function example() {
  // Create
  const user = new User();
  user.email = 'test@example.com';
  user.name = 'Test User';
  await user.save();

  // Find with options
  const users = await User.find({
    where: {
      field: 'email',
      operator: 'like',
      value: '%@example.com'
    }
  });
}
```

## Core Concepts

### Database
The JsonDB class handles all file operations and data management. It stores data in a JSON file and provides in-memory indexing for improved query performance.

```typescript
const db = new JsonDB('database.json', true); // Second parameter is autoSave
```

### Entities
Entities are TypeScript classes that represent your data structure. They extend BaseEntity and use decorators to define their schema.

```typescript
@Entity('posts')
class Post extends BaseEntity {
  @Column({ type: 'number', primary: true })
  id: number;

  @Column({ type: 'string', index: true })
  title: string;

  @Column({ type: 'number', index: true })
  userId: number;
}
```

### Columns
The Column decorator defines the properties of your entity fields.

```typescript
interface ColumnConfig {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  primary?: boolean;
  unique?: boolean;
  index?: boolean;
  default?: any;
}
```

## Querying

### Basic Queries
```typescript
// Find all
const users = await User.find();

// Find with where clause
const admins = await User.find({
  where: {
    field: 'role',
    operator: 'eq',
    value: 'admin'
  }
});

// Find with complex conditions
const results = await User.find({
  where: {
    operator: 'and',
    conditions: [
      {
        field: 'role',
        operator: 'eq',
        value: 'admin'
      },
      {
        field: 'active',
        operator: 'eq',
        value: true
      }
    ]
  }
});
```

### Query Options
```typescript
interface QueryOptions<T> {
  where?: WhereCondition<T> | LogicalCondition<T>;
  orderBy?: SortOption<T> | SortOption<T>[];
  pagination?: PaginationOption;
  select?: (keyof T)[];
}

// Example
const users = await User.find({
  where: { field: 'role', operator: 'eq', value: 'admin' },
  orderBy: { field: 'createdAt', direction: 'desc' },
  pagination: { limit: 10, offset: 0 },
  select: ['id', 'email', 'name']
});
```

### Query Operators
- `eq`: Equal
- `ne`: Not Equal
- `gt`: Greater Than
- `gte`: Greater Than or Equal
- `lt`: Less Than
- `lte`: Less Than or Equal
- `like`: Pattern Matching
- `in`: In Array
- `between`: Between Values
- `exists`: Property Exists

### Query Builder
```typescript
const users = await User.createQueryBuilder()
  .where({ field: 'role', operator: 'eq', value: 'admin' })
  .orderBy('name', 'asc')
  .limit(10)
  .getMany();
```

## Indexing

Indexes improve query performance for frequently accessed fields.

```typescript
@Entity('users')
class User extends BaseEntity {
  @Column({ type: 'string', index: true })
  email: string;  // This field will be indexed

  @Column({ type: 'string', unique: true, index: true })
  username: string;  // Unique index
}
```

## API Reference

### JsonDB Class
```typescript
class JsonDB {
  constructor(filePath: string, autoSave?: boolean);
  
  findWithOptions<T>(
    entityClass: new () => T,
    options: QueryOptions<T>
  ): Promise<T[]>;
  
  save<T>(entity: T): Promise<T>;
  
  remove<T>(entity: T): Promise<void>;
}
```

### BaseEntity Class
```typescript
abstract class BaseEntity {
  static find<T>(options?: QueryOptions<T>): Promise<T[]>;
  static createQueryBuilder<T>(): QueryBuilder<T>;
  save(): Promise<this>;
  remove(): Promise<void>;
}
```

### Decorators
```typescript
function Entity(tableName: string): ClassDecorator;
function Column(config: ColumnConfig): PropertyDecorator;
```

## Examples

### Basic CRUD Operations
```typescript
// Create
const user = new User();
user.email = 'test@example.com';
await user.save();

// Read
const users = await User.find({
  where: { field: 'email', operator: 'eq', value: 'test@example.com' }
});

// Update
user.name = 'Updated Name';
await user.save();

// Delete
await user.remove();
```

### Complex Queries
```typescript
const results = await User.find({
  where: {
    operator: 'and',
    conditions: [
      {
        field: 'role',
        operator: 'eq',
        value: 'admin'
      },
      {
        field: 'active',
        operator: 'eq',
        value: true
      },
      {
        operator: 'or',
        conditions: [
          {
            field: 'lastLogin',
            operator: 'gt',
            value: new Date('2024-01-01')
          },
          {
            field: 'neverExpires',
            operator: 'eq',
            value: true
          }
        ]
      }
    ]
  },
  orderBy: { field: 'lastLogin', direction: 'desc' },
  pagination: { limit: 10, offset: 0 }
});
```

### Using Query Builder
```typescript
const activeAdmins = await User.createQueryBuilder()
  .where({
    operator: 'and',
    conditions: [
      { field: 'role', operator: 'eq', value: 'admin' },
      { field: 'active', operator: 'eq', value: true }
    ]
  })
  .orderBy('lastLogin', 'desc')
  .limit(10)
  .getMany();
```

### Entity Relationships
```typescript
@Entity('users')
class User extends BaseEntity {
  @Column({ type: 'number', primary: true })
  id: number;

  @Column({ type: 'string' })
  name: string;

  async getPosts(): Promise<Post[]> {
    return await Post.find({
      where: { field: 'userId', operator: 'eq', value: this.id }
    });
  }
}

@Entity('posts')
class Post extends BaseEntity {
  @Column({ type: 'number', primary: true })
  id: number;

  @Column({ type: 'number', index: true })
  userId: number;

  async getUser(): Promise<User | null> {
    const users = await User.find({
      where: { field: 'id', operator: 'eq', value: this.userId }
    });
    return users[0] || null;
  }
}
```

## Error Handling
```typescript
try {
  const user = new User();
  user.email = 'duplicate@email.com';
  await user.save();
} catch (error) {
  if (error.message.includes('Unique constraint')) {
    console.log('Email already exists');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Best Practices
1. Always define primary keys
2. Use indexes for frequently queried fields
3. Keep the database file size manageable
4. Implement proper error handling
5. Use transactions for related operations
