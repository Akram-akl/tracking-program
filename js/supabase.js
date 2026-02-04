// =====================================================
// Supabase Client with Firebase-Compatible API
// =====================================================
// This wrapper provides the SAME API as Firebase so that
// existing app.js code works with minimal changes.
// =====================================================

const SUPABASE_URL = 'https://zznrfwufndtvoezzmqzn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_reuGl8XETFnFxNZMtK_snA_iYVWz5uO';

// Initialize Supabase Client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Expose globally for debugging
window.supabaseClient = supabaseClient;

// =====================================================
// Firebase-Compatible API Wrapper
// =====================================================

// Utility: Convert camelCase to snake_case
function toSnakeCase(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            result[snakeKey] = obj[key];
        }
    }
    return result;
}

// Utility: Convert snake_case to camelCase
function toCamelCase(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = obj[key];
        }
    }
    return result;
}

// ===== COLLECTION REFERENCE (just stores table name) =====
function collection(db, tableName) {
    return { _table: tableName, _type: 'collection' };
}

// ===== DOCUMENT REFERENCE =====
function doc(db, tableName, docId) {
    return { _table: tableName, _id: docId, _type: 'doc' };
}

// ===== QUERY BUILDER =====
function query(collectionRef, ...constraints) {
    return {
        _table: collectionRef._table,
        _constraints: constraints,
        _type: 'query'
    };
}

// ===== WHERE CONSTRAINT =====
function where(field, operator, value) {
    return { _field: field, _op: operator, _value: value, _type: 'where' };
}

// ===== ORDER BY (not fully implemented, Supabase handles differently) =====
function orderBy(field, direction) {
    return { _field: field, _direction: direction, _type: 'orderBy' };
}

// ===== ADD DOCUMENT =====
async function addDoc(collectionRef, data) {
    const snakeData = toSnakeCase(data);
    // Remove ID if present to let Supabase handle auto-gen (UUID)
    delete snakeData.id;

    snakeData.created_at = new Date().toISOString();
    snakeData.updated_at = new Date().toISOString();

    const { data: result, error } = await supabaseClient
        .from(collectionRef._table)
        .insert([snakeData])
        .select()
        .single();

    if (error) {
        console.error('addDoc error:', error);
        throw error;
    }
    return {
        id: result.id,
        ref: { _table: collectionRef._table, _id: result.id, _type: 'doc' }
    };
}

// ===== GET SINGLE DOCUMENT =====
async function getDoc(docRef) {
    const { data, error } = await supabaseClient
        .from(docRef._table)
        .select('*')
        .eq('id', docRef._id)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('getDoc error:', error);
        throw error;
    }

    if (!data) {
        return { exists: () => false, data: () => null, id: null };
    }

    return {
        exists: () => true,
        data: () => toCamelCase(data),
        id: data.id,
        ref: { _table: docRef._table, _id: data.id, _type: 'doc' }
    };
}

// ===== GET MULTIPLE DOCUMENTS =====
async function getDocs(queryOrCollection) {
    let tableName = queryOrCollection._table;
    let constraints = queryOrCollection._constraints || [];

    let query = supabaseClient.from(tableName).select('*');

    // Apply constraints
    for (const c of constraints) {
        if (c._type === 'where') {
            const field = c._field.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (c._op === '==') {
                query = query.eq(field, c._value);
            } else if (c._op === 'in') {
                query = query.in(field, c._value);
            } else if (c._op === 'array-contains') {
                query = query.contains(field, [c._value]);
            }
        }
    }

    const { data, error } = await query;

    if (error) {
        console.error('getDocs error:', error);
        throw error;
    }

    const docs = (data || []).map(row => ({
        id: row.id,
        data: () => toCamelCase(row),
        ref: { _table: tableName, _id: row.id, _type: 'doc' }
    }));

    return {
        empty: docs.length === 0,
        docs: docs,
        forEach: (callback) => docs.forEach(callback),
        size: docs.length
    };
}

// ===== UPDATE DOCUMENT =====
async function updateDoc(docRef, data) {
    const snakeData = toSnakeCase(data);
    snakeData.updated_at = new Date().toISOString();

    const { error } = await supabaseClient
        .from(docRef._table)
        .update(snakeData)
        .eq('id', docRef._id);

    if (error) {
        console.error('updateDoc error:', error);
        throw error;
    }
}

// ===== DELETE DOCUMENT =====
async function deleteDoc(docRef) {
    const { error } = await supabaseClient
        .from(docRef._table)
        .delete()
        .eq('id', docRef._id);

    if (error) {
        console.error('deleteDoc error:', error);
        throw error;
    }
}

// ===== REALTIME SUBSCRIPTION (onSnapshot) =====
function onSnapshot(queryOrCollection, callback) {
    const tableName = queryOrCollection._table;

    // Initial fetch
    getDocs(queryOrCollection).then(callback).catch(console.error);

    // Subscribe to realtime changes
    const channelName = `${tableName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const channel = supabaseClient
        .channel(channelName)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tableName },
            async () => {
                // Refetch data on any change
                try {
                    const result = await getDocs(queryOrCollection);
                    callback(result);
                } catch (e) {
                    console.error('onSnapshot refetch error:', e);
                }
            }
        )
        .subscribe();

    // Return unsubscribe function
    return () => {
        supabaseClient.removeChannel(channel);
    };
}

// ===== WRITE BATCH (for batch operations) =====
function writeBatch(db) {
    const operations = [];
    return {
        delete: (docRef) => {
            operations.push({ type: 'delete', ref: docRef });
        },
        set: (docRef, data) => {
            // For Supabase, set is often add or update. In app.js contexts, usually add.
            operations.push({ type: 'set', ref: docRef, data: data });
        },
        update: (docRef, data) => {
            operations.push({ type: 'update', ref: docRef, data: data });
        },
        commit: async () => {
            for (const op of operations) {
                if (op.type === 'delete') {
                    await deleteDoc(op.ref);
                } else if (op.type === 'set') {
                    // Ignore the provided ID in batch.set if it exists (usually "temp_sid")
                    await addDoc({ _table: op.ref._table }, op.data);
                } else if (op.type === 'update') {
                    await updateDoc(op.ref, op.data);
                }
            }
        }
    };
}

// =====================================================
// EXPOSE AS FIREBASE-COMPATIBLE API
// =====================================================
window.db = { _supabase: true }; // Placeholder for db reference

window.firebaseOps = {
    collection,
    doc,
    query,
    where,
    orderBy,
    addDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    onSnapshot,
    writeBatch
};

// Signal that database is ready
console.log('Supabase Initialized (Firebase-Compatible Mode)');
window.dispatchEvent(new Event('firebaseReady'));
