import admin from 'firebase-admin';

let firebaseApp: admin.app.App;
try {
  firebaseApp = admin.app();
} catch (error) {
  firebaseApp = admin.initializeApp();
}

export const app = firebaseApp;
export const database = admin.database();
