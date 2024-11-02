
// Types and Interfaces
type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
export type GroupByFunction = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';

interface ColumnConfig {
	type: ColumnType;
	primary?: boolean;
	unique?: boolean;
	default?: any;
	index?: boolean;
}

interface EntityConfig {
	tableName: string;
	columns: Map<string, ColumnConfig>;
	indices: Set<string>;
}

interface QueryOptions<T> {
	where?: WhereCondition<T> | LogicalCondition<T>;
	orderBy?: SortOption<T> | SortOption<T>[];
	groupBy?: GroupByOption<T> | GroupByOption<T>[];
	pagination?: PaginationOption;
	joins?: JoinOption<T, any>[];
	select?: (keyof T)[];
}

interface WhereCondition<T> {
	field: keyof T;
	operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'nin' |
	'between' | 'exists' | 'null' | 'contains' | 'startsWith' | 'endsWith';
	value: any;
}

interface LogicalCondition<T> {
	operator: 'and' | 'or' | 'not';
	conditions: (WhereCondition<T> | LogicalCondition<T>)[];
}

interface SortOption<T> {
	field: keyof T;
	direction: 'asc' | 'desc';
}


interface PaginationOption {
	page?: number;
	limit?: number;
	offset?: number;
}

interface JoinOption<T, R> {
	entity: new () => R;
	field: keyof R;
	alias?: string;
	type?: 'inner' | 'left' | 'right';
	on?: WhereCondition<T | R>;
}

export interface GroupByOption<T> {
	field: keyof T;
	function?: GroupByFunction;
	having?: WhereCondition<T>;
}


// Registry for storing entity metadata
const EntityRegistry = new Map<Function, EntityConfig>();

// Decorators
export function Entity(tableName: string) {
	return function (constructor: Function) {
		if (!EntityRegistry.has(constructor)) {
			EntityRegistry.set(constructor, {
				tableName,
				columns: new Map(),
				indices: new Set()
			});
		}
	};
}

export function Column(config: ColumnConfig) {
	return function (target: any, propertyKey: string) {
		const constructor = target.constructor;

		let entityConfig = EntityRegistry.get(constructor);
		if (!entityConfig) {
			entityConfig = {
				tableName: constructor.name.toLowerCase(),
				columns: new Map(),
				indices: new Set()
			};
			EntityRegistry.set(constructor, entityConfig);
		}

		entityConfig.columns.set(propertyKey, config);

		if (config.index || config.unique) {
			entityConfig.indices.add(propertyKey);
		}
	};
}

// Index Structure Implementation
class IndexStructure {
	private btree: Map<any, Set<any>> = new Map();
	private hash: Map<any, Set<any>> = new Map();

	constructor(
		private indexType: 'btree' | 'hash' | 'both' = 'both',
		private isUnique: boolean = false
	) { }

	add(value: any, id: any) {
		if (this.isUnique) {
			const existing = this.hash.get(value);
			if (existing && existing.size > 0) {
				throw new Error(`Unique constraint violation for value: ${value}`);
			}
		}

		if (this.indexType !== 'hash') {
			if (!this.btree.has(value)) {
				this.btree.set(value, new Set());
			}
			this.btree.get(value)!.add(id);
		}

		if (this.indexType !== 'btree') {
			if (!this.hash.has(value)) {
				this.hash.set(value, new Set());
			}
			this.hash.get(value)!.add(id);
		}
	}

	remove(value: any, id: any) {
		if (this.indexType !== 'hash') {
			const btreeSet = this.btree.get(value);
			if (btreeSet) {
				btreeSet.delete(id);
				if (btreeSet.size === 0) {
					this.btree.delete(value);
				}
			}
		}

		if (this.indexType !== 'btree') {
			const hashSet = this.hash.get(value);
			if (hashSet) {
				hashSet.delete(id);
				if (hashSet.size === 0) {
					this.hash.delete(value);
				}
			}
		}
	}

	findEqual(value: any): Set<any> {
		if (this.indexType !== 'btree') {
			return this.hash.get(value) || new Set();
		}
		return this.btree.get(value) || new Set();
	}

	findRange(start: any, end: any): Set<any> {
		if (this.indexType === 'hash') {
			throw new Error('Range queries not supported on hash index');
		}

		const result = new Set<any>();
		for (const [value, ids] of this.btree.entries()) {
			if (value >= start && value <= end) {
				ids.forEach(id => result.add(id));
			}
		}
		return result;
	}

	findGreaterThan(value: any): Set<any> {
		return this.findRange(value, Infinity);
	}

	findLessThan(value: any): Set<any> {
		return this.findRange(-Infinity, value);
	}
}

// JsonDB Implementation
export class JsonDB {
	private data: Map<string, Map<any, any>> = new Map();
	private indices: Map<string, Map<string, IndexStructure>> = new Map();
	private filePath: string;
	private autoSave: boolean;

	constructor(filePath: string, autoSave: boolean = true) {
		this.filePath = filePath;
		this.autoSave = autoSave;
		this.loadDatabase();
	}

	private async loadDatabase() {
		try {
			const file = Bun.file(this.filePath);

			if (await file.exists()) {
				const content = await file.text();

				const rawData = JSON.parse(content);

				if (rawData && rawData.data) {
					Object.entries(rawData.data).forEach(([tableName, records]) => {
						const tableMap = new Map(Object.entries(records as { [key: string]: any }));
						this.data.set(tableName, tableMap);
					});

					await this.rebuildIndices();
				} else {
					console.warn("No 'data' field found in the JSON file.");
				}

			}
		} catch (error) {
			console.error('Error loading database:', error);
			throw new Error('Failed to load database');
		}
	}

	private async saveDatabase() {
		try {
			const data = {
				data: Object.fromEntries(
					Array.from(this.data.entries()).map(([tableName, records]) => [
						tableName,
						Object.fromEntries(records)
					])
				)
			};

			await Bun.write(this.filePath, JSON.stringify(data, null, 2));
		} catch (error) {
			console.error('Error saving database:', error);
			throw new Error('Failed to save database');
		}
	}

	private async rebuildIndices() {
		this.indices.clear();

		for (const [tableName, records] of this.data.entries()) {
			const entityClass = Array.from(EntityRegistry.entries())
				.find(([_, config]) => config.tableName === tableName)?.[0];

			if (entityClass) {
				const config = EntityRegistry.get(entityClass)!;
				const tableIndices = new Map<string, IndexStructure>();
				this.indices.set(tableName, tableIndices);

				// Create indices for each indexed column
				config.columns.forEach((columnConfig, columnName) => {
					if (columnConfig.index || columnConfig.unique) {
						const indexType = this.determineIndexType(columnConfig.type);
						const index = new IndexStructure(
							indexType,
							columnConfig.unique
						);

						// Populate index
						records.forEach((record, id) => {
							index.add(record[columnName], id);
						});

						tableIndices.set(columnName, index);
					}
				});
			}
		}
	}

	private determineIndexType(columnType: ColumnType): 'btree' | 'hash' | 'both' {
		switch (columnType) {
			case 'number':
			case 'date':
				return 'btree';
			case 'string':
				return 'both';
			default:
				return 'hash';
		}
	}

	private async updateIndices(
		tableName: string,
		id: any,
		record: any,
		isRemove: boolean = false
	) {
		const tableIndices = this.indices.get(tableName);
		if (!tableIndices) return;

		tableIndices.forEach((index, columnName) => {
			const value = record[columnName];
			if (isRemove) {
				index.remove(value, id);
			} else {
				index.add(value, id);
			}
		});
	}

	async findWithOptions<T extends { id: any }>(
		entityClass: abstract new () => T,
		options: QueryOptions<T>
	): Promise<T[]> {
		const config = EntityRegistry.get(entityClass as any);
		if (!config) throw new Error('Entity not registered');

		const tableData = this.data.get(config.tableName);
		if (!tableData) return [];

		let results: T[] = [];

		// Handle where conditions
		if (options.where) {
			results = await this.executeWhere(
				config.tableName,
				tableData,
				options.where
			) as T[];
		} else {
			results = Array.from(tableData.values());
		}

		// Apply joins if any
		if (options.joins) {
			results = await this.executeJoins(results, options.joins);
		}

		// Apply grouping
		if (options.groupBy) {
			results = this.executeGroupBy(results, options.groupBy);
		}

		// Apply sorting
		if (options.orderBy) {
			results = this.executeOrderBy(results, options.orderBy);
		}

		// Apply pagination
		if (options.pagination) {
			results = this.executePagination(results, options.pagination);
		}

		// Apply field selection
		if (options.select) {
			results = this.executeSelect(results, options.select);
		}

		return results;
	}

	async save<T>(entity: T): Promise<T> {
		const constructor = (entity as any).constructor as Function;
		const config = EntityRegistry.get(constructor);
		if (!config) throw new Error('Entity not registered');

		const tableData = this.data.get(config.tableName)
			|| new Map();
		this.data.set(config.tableName, tableData);

		let id: any;
		config.columns.forEach((columnConfig, columnName) => {
			if (columnConfig.primary) {
				id = (entity as any)[columnName];
				if (!id) {
					id = Date.now() + Math.random();
					(entity as any)[columnName] = id;
				}
			}
		});

		if (!id) throw new Error('No primary key found');

		// Check unique constraints
		await this.checkUniqueConstraints(config, tableData, entity, id);

		// Save entity
		tableData.set(id, { ...entity });
		await this.updateIndices(config.tableName, id, entity);

		if (this.autoSave) {
			await this.saveDatabase();
		}

		return entity;
	}

	async remove<T>(entity: T): Promise<void> {
		const constructor = Object.getPrototypeOf(entity).constructor as Function;
		const config = EntityRegistry.get(constructor);
		if (!config) throw new Error('Entity not registered');

		const tableData = this.data.get(config.tableName);
		if (!tableData) return;

		const primaryKeyEntry = Array.from(config.columns.entries())
			.find(([_, col]) => col.primary);

		if (!primaryKeyEntry) {
			throw new Error('No primary key defined');
		}

		const [primaryKey] = primaryKeyEntry;
		const id = (entity as any)[primaryKey];

		if (id === undefined) {
			throw new Error('Entity has no primary key value');
		}

		// Remove from indices first
		await this.removeFromIndices(config.tableName, id, entity);

		// Remove from main data
		tableData.delete(id);

		if (this.autoSave) {
			await this.saveDatabase();
		}
	}

	private async removeFromIndices(
		tableName: string,
		id: any,
		entity: any
	): Promise<void> {
		const tableIndices = this.indices.get(tableName);
		if (!tableIndices) return;

		for (const [columnName, index] of tableIndices.entries()) {
			const value = entity[columnName];
			index.remove(value, id);
		}
	}

	private async checkUniqueConstraints<T>(
		config: EntityConfig,
		tableData: Map<any, any>,
		entity: T,
		excludeId: any
	) {
		for (const [columnName, columnConfig] of config.columns.entries()) {
			if (columnConfig.unique) {
				const value = (entity as any)[columnName];
				const existing = Array.from(tableData.values()).find(
					record =>
						record[columnName] === value &&
						record.id !== excludeId
				);

				if (existing) {
					throw new Error(
						`Unique constraint violation: ${columnName} = ${value}`
					);
				}
			}
		}
	}

	private async executeWhere<T extends { id: any }>(
		tableName: string,
		tableData: Map<any, any>,
		condition: WhereCondition<T> | LogicalCondition<T>
	): Promise<T[]> {
		if ('operator' in condition &&
			['and', 'or', 'not'].includes(condition.operator)) {
			return this.executeLogicalCondition(
				tableName,
				tableData,
				condition as LogicalCondition<T>
			);
		}

		return this.executeSimpleCondition(
			tableName,
			tableData,
			condition as WhereCondition<T>
		);
	}

	private async executeSimpleCondition<T>(
		tableName: string,
		tableData: Map<any, any>,
		condition: WhereCondition<T>
	): Promise<T[]> {
		const { field, operator, value } = condition;
		const tableIndices = this.indices.get(tableName);
		const index = tableIndices?.get(field as string);

		if (index && ['eq', 'gt', 'lt', 'between'].includes(operator)) {
			let matchingIds: Set<any>;

			switch (operator) {
				case 'eq':
					matchingIds = index.findEqual(value);
					break;
				case 'gt':
					matchingIds = index.findGreaterThan(value);
					break;
				case 'lt':
					matchingIds = index.findLessThan(value);
					break;
				case 'between':
					matchingIds = index.findRange(value[0], value[1]);
					break;
				default:
					matchingIds = new Set();
			}

			return Array.from(matchingIds)
				.map(id => tableData.get(id))
				.filter(Boolean);
		}

		return Array.from(tableData.values()).filter(record => {
			const recordValue = record[field as string];

			switch (operator) {
				case 'eq':
					return recordValue === value;
				case 'ne':
					return recordValue !== value;
				case 'gt':
					return recordValue > value;
				case 'gte':
					return recordValue >= value;
				case 'lt':
					return recordValue < value;
				case 'lte':
					return recordValue <= value;
				case 'like':
					return String(recordValue).includes(value);
				case 'in':
					return value.includes(recordValue);
				case 'nin':
					return !value.includes(recordValue);
				case 'between':
					return recordValue >= value[0] && recordValue <= value[1];
				case 'exists':
					return recordValue !== undefined;
				case 'null':
					return recordValue === null;
				case 'contains':
					return Array.isArray(recordValue) && recordValue.includes(value);
				case 'startsWith':
					return String(recordValue).startsWith(value);
				case 'endsWith':
					return String(recordValue).endsWith(value);
				default:
					return false;
			}
		});
	}

	private async executeLogicalCondition<T extends { id: any }>(
		tableName: string,
		tableData: Map<any, any>,
		condition: LogicalCondition<T>
	): Promise<T[]> {
		const results = await Promise.all(
			condition.conditions.map(cond =>
				this.executeWhere(tableName, tableData, cond)
			)
		);

		switch (condition.operator) {
			case 'and':
				return results.reduce((acc, curr) =>
					acc.filter(record =>
						curr.some(r => r.id === record.id)
					)
				);
			case 'or':
				return [...new Set(results.flat())];
			case 'not':
				const excludedIds = new Set(results[0].map(r => r.id));
				return Array.from(tableData.values())
					.filter(record => !excludedIds.has(record.id));
			default:
				return [];
		}
	}

	private async executeJoins<T>(
		results: T[],
		joins: JoinOption<T, any>[]
	): Promise<T[]> {
		for (const join of joins) {
			const joinConfig = EntityRegistry.get(join.entity);
			if (!joinConfig) continue;

			const joinData = this.data.get(joinConfig.tableName);
			if (!joinData) continue;

			results = results.map(record => {
				const joinRecords = Array.from(joinData.values())
					.filter(joinRecord => {
						if (join.on) {
							return this.evaluateJoinCondition(record, joinRecord, join.on);
						}
						return joinRecord[join.field] === (record as any).id;
					});

				const joinResult = join.type === 'left' || !joinRecords.length
					? [null]
					: joinRecords;

				return {
					...record,
					[join.alias || joinConfig.tableName]: joinResult
				};
			});
		}

		return results;
	}

	private executeGroupBy<T extends Record<string, any>>(
		results: T[],
		groupBy: GroupByOption<T> | GroupByOption<T>[]
	): T[] {
		const groups = new Map<string, T[]>();
		const groupings = Array.isArray(groupBy) ? groupBy : [groupBy];

		results.forEach(record => {
			const groupKey = groupings
				.map(g => String(record[g.field]))
				.join('::');

			if (!groups.has(groupKey)) {
				groups.set(groupKey, []);
			}
			groups.get(groupKey)!.push(record);
		});

		return Array.from(groups.entries()).map(([key, group]) => {
			const result: any = {};

			groupings.forEach(g => {
				const field = g.field as string;
				result[field] = group[0][field];

				if (g.function) {
					const aggregateField = `${g.function}_${field}`;
					switch (g.function) {
						case 'count':
							result[aggregateField] = group.length;
							break;
						case 'sum':
							result[aggregateField] = group.reduce(
								(sum, r) => sum + (r[field] as number),
								0
							);
							break;
						case 'avg':
							result[aggregateField] = group.reduce(
								(sum, r) => sum + (r[field] as number),
								0
							) / group.length;
							break;
						case 'min':
							result[aggregateField] = Math.min(
								...group.map((r: T & Record<string, any>) => r[field] as number)
							);
							break;
						case 'max':
							result[aggregateField] = Math.max(
								...group.map(r => r[field] as number)
							);
							break;
						case 'distinct':
							result[aggregateField] = [...new Set(
								group.map((r: any) => r[field])
							)];
							break;
					}
				}
			});

			return result;
		});
	}

	private executeOrderBy<T>(
		results: T[],
		orderBy: SortOption<T> | SortOption<T>[]
	): T[] {
		const sortings = Array.isArray(orderBy) ? orderBy : [orderBy];

		return [...results].sort((a, b) => {
			for (const sort of sortings) {
				const aVal = a[sort.field];
				const bVal = b[sort.field];

				if (aVal === bVal) continue;

				return sort.direction === 'asc'
					? aVal > bVal ? 1 : -1
					: aVal < bVal ? 1 : -1;
			}
			return 0;
		});
	}

	private executePagination<T>(
		results: T[],
		pagination: PaginationOption
	): T[] {
		const { page, limit, offset } = pagination;
		const skip = offset || (page && limit ? (page - 1) * limit : 0) || 0;
		const take = limit || results.length;

		return results.slice(skip, skip + take);
	}

	private executeSelect<T>(
		results: T[],
		select: (keyof T)[]
	): T[] {
		return results.map(record => {
			const selected: any = {};
			select.forEach(field => {
				selected[field] = record[field];
			});
			return selected as T;
		});
	}

	private evaluateJoinCondition(
		record: any,
		joinRecord: any,
		condition: WhereCondition<any>
	): boolean {
		const { field, operator, value } = condition;
		const recordValue = record[field] || joinRecord[field];

		switch (operator) {
			case 'eq':
				return recordValue === value;
			default:
				return false;
		}
	}
}

// Query Builder Implementation
class QueryBuilder<T extends BaseEntity> {
	private options: QueryOptions<T> = {};

	constructor(private entityClass: typeof BaseEntity & (new () => T)) { }

	select(...fields: (keyof T)[]): this {
		this.options.select = fields;
		return this;
	}

	where(condition: WhereCondition<T>): this {
		this.options.where = condition;
		return this;
	}

	andWhere(...conditions: WhereCondition<T>[]): this {
		this.options.where = {
			operator: 'and',
			conditions
		};
		return this;
	}

	orWhere(...conditions: WhereCondition<T>[]): this {
		this.options.where = {
			operator: 'or',
			conditions
		};
		return this;
	}

	orderBy(field: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
		const sort: SortOption<T> = { field, direction };
		this.options.orderBy = this.options.orderBy
			? [...(this.options.orderBy as SortOption<T>[]), sort]
			: sort;
		return this;
	}

	limit(limit: number): this {
		this.options.pagination = { ...this.options.pagination, limit };
		return this;
	}

	offset(offset: number): this {
		this.options.pagination = { ...this.options.pagination, offset };
		return this;
	}

	join<R>(
		entity: new () => R,
		field: keyof R,
		options: Partial<JoinOption<T, R>> = {}
	): this {
		const join: JoinOption<T, R> = {
			entity,
			field,
			type: 'inner',
			...options
		};

		this.options.joins = this.options.joins
			? [...this.options.joins, join]
			: [join];
		return this;
	}

	groupBy(field: keyof T, fn?: GroupByFunction): this {
		const group: GroupByOption<T> = { field, function: fn };
		this.options.groupBy = this.options.groupBy
			? [...(this.options.groupBy as GroupByOption<T>[]), group]
			: group;
		return this;
	}

	async getMany(): Promise<T[]> {
		return await this.entityClass.find(this.options);
	}

	async getOne(): Promise<T | null> {
		const results = await this.limit(1).getMany();
		return results[0] || null;
	}

	getOptions(): QueryOptions<T> {
		return this.options;
	}
}

// Base Entity Implementation
export abstract class BaseEntity {
	id: any;
	private static db: JsonDB;

	static setDatabase(db: JsonDB) {
		this.db = db;
	}

	protected static getDatabase(): JsonDB {
		if (!this.db) {
			throw new Error('Database not initialized');
		}
		return this.db;
	}

	static createQueryBuilder<T extends BaseEntity>(
		this: typeof BaseEntity & (new () => T)
	): QueryBuilder<T> {
		return new QueryBuilder<T>(this);
	}

	static async find<T extends BaseEntity>(
		this: typeof BaseEntity & (new () => T),
		options: QueryOptions<T> = {}
	): Promise<T[]> {
		const db = BaseEntity.getDatabase();
		return await db.findWithOptions(this, options) as unknown as T[];
	}

	static async findOne<T extends BaseEntity>(
		this: typeof BaseEntity & (new () => T),
		where: Partial<T>
	): Promise<T | null> {
		const results = await this.find({
			where: BaseEntity.convertToWhereCondition(where),
			pagination: { limit: 1 }
		});
		if (results.length === 0) return null;

		// Create a new instance and assign properties
		const instance = Object.create(this.prototype);
		Object.assign(instance, results[0]);
		return instance;
	}

	static async findById<T extends BaseEntity>(
		this: typeof BaseEntity & (new () => T),
		id: number | string
	): Promise<T | null> {
		const config = EntityRegistry.get(this);
		if (!config) throw new Error('Entity not registered');

		const primaryKey = Array.from(config.columns.entries())
			.find(([_, col]) => col.primary)?.[0];

		if (!primaryKey) throw new Error('No primary key defined');

		return await this.findOne({ [primaryKey]: id } as any);
	}

	private static convertToWhereCondition<T>(where: Partial<T>): WhereCondition<T> | LogicalCondition<T> {
		const conditions = Object.entries(where).map(([field, value]) => ({
			field: field as keyof T,
			operator: 'eq' as const,
			value
		}));

		return conditions.length === 1
			? conditions[0]
			: {
				operator: 'and',
				conditions
			};
	}

	async save(): Promise<this> {
		const db = (this.constructor as typeof BaseEntity).getDatabase();
		const saved = await db.save(this);
		Object.assign(this, saved);
		return this;
	}

	async remove(): Promise<void> {
		const db = (this.constructor as typeof BaseEntity).getDatabase();
		await db.remove(this);
	}

	async reload(): Promise<this> {
		const constructor = this.constructor as typeof BaseEntity & (new () => this);
		const config = EntityRegistry.get(constructor);
		if (!config) throw new Error('Entity not registered');

		const primaryKey = Array.from(config.columns.entries())
			.find(([_, col]) => col.primary)?.[0];

		if (!primaryKey) throw new Error('No primary key defined');

		const id = (this as any)[primaryKey];
		const results = await constructor.find({
			where: {
				field: primaryKey as any,
				operator: 'eq',
				value: id
			},
			pagination: { limit: 1 }
		});

		const reloaded = results[0];
		if (!reloaded) throw new Error('Entity not found');

		Object.assign(this, reloaded);
		return this;
	}
}
