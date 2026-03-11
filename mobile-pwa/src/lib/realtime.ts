'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';

interface RealtimeResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

export function useApprovalQueue(userId: string | null): RealtimeResult<DocumentData & { id: string }> {
  const [data, setData] = useState<(DocumentData & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setData([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'approval_queue'),
      where('ownerId', '==', userId),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setData(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  return { data, loading, error };
}

export function useSurfaces(userId: string | null): RealtimeResult<DocumentData & { id: string }> {
  const [data, setData] = useState<(DocumentData & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setData([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'surfaces'),
      where('ownerId', '==', userId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setData(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  return { data, loading, error };
}

export function useMemory(
  userId: string | null,
  domain?: string
): RealtimeResult<DocumentData & { id: string }> {
  const [data, setData] = useState<(DocumentData & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setData([]);
      setLoading(false);
      return;
    }

    const constraints = [
      where('ownerId', '==', userId),
    ];
    if (domain) {
      constraints.push(where('domain', '==', domain));
    }

    const q = query(
      collection(db, 'memory'),
      ...constraints,
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setData(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId, domain]);

  return { data, loading, error };
}

export interface UserSettings {
  autoApproveLow: boolean;
  notificationsEnabled: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  autoApproveLow: false,
  notificationsEnabled: true,
};

export function useUserSettings(userId: string | null) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }

    const docRef = doc(db, 'user_settings', userId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setSettings({
            autoApproveLow: data.autoApproveLow ?? false,
            notificationsEnabled: data.notificationsEnabled ?? true,
          });
        }
        setLoading(false);
      },
      () => setLoading(false)
    );

    return unsubscribe;
  }, [userId]);

  const updateSettings = async (updates: Partial<UserSettings>) => {
    if (!userId) return;
    const merged = { ...settings, ...updates };
    setSettings(merged);
    await setDoc(doc(db, 'user_settings', userId), merged, { merge: true });
  };

  return { settings, loading, updateSettings };
}

export function useTasks(userId: string | null): RealtimeResult<DocumentData & { id: string }> {
  const [data, setData] = useState<(DocumentData & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setData([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'tasks'),
      where('ownerId', '==', userId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setData(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  return { data, loading, error };
}
