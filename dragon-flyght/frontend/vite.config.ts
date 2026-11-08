import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{rollupOptions:{output:{manualChunks:{'three-engine':['three','@react-three/fiber','@react-three/drei'],'analytics':['recharts'],'network':['@xyflow/react']}}}},server:{proxy:{'/api':'http://127.0.0.1:8000'}}});
