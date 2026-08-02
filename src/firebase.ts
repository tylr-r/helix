import { App, getApp, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

let firebaseApp: App;
try {
  firebaseApp = getApp();
} catch {
  firebaseApp = initializeApp();
}

export const app = firebaseApp;
export const database = getDatabase(firebaseApp);
