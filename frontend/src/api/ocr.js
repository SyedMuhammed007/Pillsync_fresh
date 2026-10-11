import axios from 'axios';

export const ocrApi = {
  scanPrescription: async (file) => {
    const formData = new FormData();
    formData.append('image', file);

    const token = localStorage.getItem('accessToken');
    const headers = {
      'Content-Type': 'multipart/form-data',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const endpoints = [
      '/api/ocr/',
      'http://127.0.0.1:8000/api/ocr/',
      'http://localhost:8000/api/ocr/',
    ];

    let lastError = null;
    for (const url of endpoints) {
      try {
        const response = await axios.post(url, formData, {
          headers,
          timeout: 45000,
        });
        if (response.data) {
          return response.data;
        }
      } catch (err) {
        lastError = err;
        // If 401 unauthorized due to stale/mock token, retry immediately without Authorization header
        if (err.response?.status === 401 && headers.Authorization) {
          try {
            const cleanHeaders = { 'Content-Type': 'multipart/form-data' };
            const retryRes = await axios.post(url, formData, {
              headers: cleanHeaders,
              timeout: 45000,
            });
            if (retryRes.data) {
              return retryRes.data;
            }
          } catch (retryErr) {
            lastError = retryErr;
          }
        }
        if (lastError.response) {
          // Server replied with an explicit HTTP status (e.g. 422 Non-medication rejection)
          break;
        }
      }
    }

    throw lastError || new Error('OCR recognition endpoint unreachable');
  },
};
