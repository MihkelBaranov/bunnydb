import { afterAll, afterEach, describe, test, expect, beforeAll } from "bun:test";
import { BaseEntity, Column, JsonDB, Entity } from "../index";

let db: JsonDB;

beforeAll(() => {
	db = new JsonDB('test.db.json');
	BaseEntity.setDatabase(db);
});

beforeAll(async () => {
	// Clean up test data
	await Bun.write('test.db.json', '{}');
});

afterAll(async () => {
	// Clean up test file
	const fs = require('fs').promises;
	await fs.unlink('test.db.json');
});

// Test Entities
@Entity('users')
class TestUser extends BaseEntity {
	@Column({ type: 'number', primary: true })
	declare id: number;

	@Column({ type: 'string', unique: true, index: true })
	email: string;

	@Column({ type: 'string' })
	name: string;

	@Column({ type: 'string', index: true })
	role: 'admin' | 'user' = 'user';

	@Column({ type: 'boolean', default: true })
	active: boolean;
}

@Entity('posts')
class TestPost extends BaseEntity {
	@Column({ type: 'number', primary: true })
	declare id: number;

	@Column({ type: 'string' })
	title: string;

	@Column({ type: 'string' })
	content: string;

	@Column({ type: 'number', index: true })
	userId: number;
}

// CRUD Operation Tests
describe('CRUD Operations', () => {
	test('should create and save entity', async () => {
		const user = new TestUser();
		user.email = 'test@example.com';
		user.name = 'Test User';

		await user.save();
		expect(user.id).toBeDefined();
	});

	test('should enforce unique constraint', async () => {
		const user1 = new TestUser();
		user1.email = 'unique@example.com';
		user1.name = 'User 1';
		await user1.save();

		const user2 = new TestUser();
		user2.email = 'unique@example.com';
		user2.name = 'User 2';

		expect(user2.save()).rejects.toThrow(/Unique constraint violation/);
	});

	test('should update entity', async () => {
		const user = new TestUser();
		user.email = 'update@example.com';
		user.name = 'Original Name';
		await user.save();

		user.name = 'Updated Name';
		await user.save();

		const results = await TestUser.find({
			where: { field: 'email', operator: 'eq', value: 'update@example.com' }
		});
		expect(results[0].name).toBe('Updated Name');
	});

	test('should remove entity', async () => {
		const user = new TestUser();
		user.email = 'delete@example.com';
		user.name = 'Delete Me';
		await user.save();

		await user.remove();

		const results = await TestUser.find({
			where: { field: 'email', operator: 'eq', value: 'delete@example.com' }
		});
		expect(results.length).toBe(0);
	});
});

// Query Tests
describe('Query Operations', () => {
	beforeAll(async () => {

		// Setup test data
		const users = [
			{ email: 'user1@example.com', name: 'User 1', role: 'admin' },
			{ email: 'user2@example.com', name: 'User 2', role: 'user' },
			{ email: 'user3@example.com', name: 'User 3', role: 'admin' },
			{ email: 'other@example.com', name: 'Other User', role: 'user' }
		];

		for (const userData of users) {
			const user = new TestUser();
			Object.assign(user, userData);
			await user.save();
		}
	});

	test('should find by simple where condition', async () => {
		const results = await TestUser.find({
			where: { field: 'role', operator: 'eq', value: 'admin' }
		});
		expect(results.length).toBe(2);
	});

	test('should find with like operator', async () => {
		const results = await TestUser.find({
			where: { field: 'email', operator: 'like', value: 'user' }
		});
		expect(results.length).toBe(3);
	});

	test('should support complex where conditions', async () => {
		const results = await TestUser.find({
			where: {
				operator: 'and',
				conditions: [
					{ field: 'role', operator: 'eq', value: 'admin' },
					{ field: 'email', operator: 'like', value: 'user' }
				]
			}
		});
		expect(results.length).toBe(2);
	});

	test('should support ordering', async () => {
		const results = await TestUser.find({
			orderBy: { field: 'email', direction: 'desc' }
		});
		expect(results[0].email > results[1].email).toBe(true);
	});

	test('should support pagination', async () => {
		const results = await TestUser.find({
			pagination: { limit: 2, offset: 1 }
		});
		expect(results.length).toBe(2);
	});

	test('should support field selection', async () => {
		const results = await TestUser.find({
			select: ['email', 'role']
		});
		expect(Object.keys(results[0])).toEqual(['email', 'role']);
	});
});

// Index Tests
describe('Index Operations', () => {
	test('should use index for equality search', async () => {
		const user = new TestUser();
		user.email = 'indexed@example.com';
		user.name = 'Indexed User';
		await user.save();

		const results = await TestUser.find({
			where: { field: 'email', operator: 'eq', value: 'indexed@example.com' }
		});
		expect(results.length).toBe(1);
		expect(results[0].name).toBe('Indexed User');
	});

	test('should maintain index after updates', async () => {
		const user = new TestUser();
		user.email = 'update.index@example.com';
		user.name = 'Original Name';
		await user.save();

		user.name = 'Updated Name';
		await user.save();

		const results = await TestUser.find({
			where: { field: 'email', operator: 'eq', value: 'update.index@example.com' }
		});
		expect(results[0].name).toBe('Updated Name');
	});
});

// Query Builder Tests
describe('Query Builder', () => {
	test('should build and execute simple query', async () => {
		const user = new TestUser();
		user.email = 'builder@example.com';
		user.name = 'Builder Test';
		await user.save();

		const result = await TestUser.createQueryBuilder()
			.where({ field: 'email', operator: 'eq', value: 'builder@example.com' })
			.getOne();

		expect(result?.name).toBe('Builder Test');
	});

	test('should build and execute complex query', async () => {
		const users = [
			{ email: 'admin1@test.com', name: 'Admin 1', role: 'admin' },
			{ email: 'admin2@test.com', name: 'Admin 2', role: 'admin' },
			{ email: 'user1@test.com', name: 'User 1', role: 'user' }
		];

		for (const userData of users) {
			const user = new TestUser();
			Object.assign(user, userData);
			await user.save();
		}

		const results = await TestUser.createQueryBuilder()
			.where({ field: 'role', operator: 'eq', value: 'admin' })
			.orderBy('name', 'asc')
			.limit(2)
			.getMany();

		expect(results.length).toBe(2);
		expect(results[0].name).toBe('Admin 1');
	});
});



// Relationship Tests
describe('Relationships', () => {
	test('should handle one-to-many relationship', async () => {
		// Create user
		const user = new TestUser();
		user.email = 'relationship@example.com';
		user.name = 'Relationship Test';
		await user.save();

		// Create posts
		const post1 = new TestPost();
		post1.title = 'Post 1';
		post1.content = 'Content 1';
		post1.userId = user.id;
		await post1.save();

		const post2 = new TestPost();
		post2.title = 'Post 2';
		post2.content = 'Content 2';
		post2.userId = user.id;
		await post2.save();

		// Query with join
		const results = await TestUser.find({
			where: { field: 'id', operator: 'eq', value: user.id },
			joins: [{
				entity: TestPost,
				field: 'userId',
				alias: 'posts'
			}]
		});

		expect((results[0] as any).posts).toHaveLength(2);
	});
});

// Transaction-like Tests
describe('Transaction-like Operations', () => {
	test('should rollback on error', async () => {
		const initialUser = new TestUser();
		initialUser.email = 'transaction@example.com';
		initialUser.name = 'Transaction Test';
		await initialUser.save();

		try {
			const user = new TestUser();
			user.email = 'transaction@example.com'; // Should fail due to unique constraint
			await user.save();
		} catch (error) {
			const results = await TestUser.find({
				where: { field: 'email', operator: 'eq', value: 'transaction@example.com' }
			});

			expect(results.length).toBe(1);
		}
	});
});

// Error Handling Tests
describe('Error Handling', () => {
	test('should handle invalid queries gracefully', async () => {
		expect(await TestUser.find({
			where: { field: 'nonexistent' as any, operator: 'eq', value: 'test' }
		})).toEqual([]);
	});
});