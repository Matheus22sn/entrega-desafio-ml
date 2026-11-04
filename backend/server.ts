import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import adsRoutes from './routes/Ads';
import { allowedFrontendOrigins } from './lib/mercadoLibre';
import { SESSION_HEADER_NAME } from './lib/session';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/desafio_ml';

// Atrás do proxy do Render: o IP real do cliente vem do primeiro salto.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeçalhos de segurança (HSTS, nosniff, frame-ancestors...). A API só devolve JSON.
app.use(helmet());

// CORS fechado por padrão: só os front-ends de FRONTEND_URL e CORS_ORIGIN.
app.use(cors({
  origin: allowedFrontendOrigins(),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', SESSION_HEADER_NAME],
}));
app.use(express.json({ limit: '200kb' }));

// Limites por IP: o login é o alvo mais sensível.
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/ads', apiLimiter, adsRoutes);

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'desafio-ml-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req: Request, res: Response) => {
  res.send('Desafio ML backend is online.');
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB successfully.');
    app.listen(PORT, () => {
      console.log(`Backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });
