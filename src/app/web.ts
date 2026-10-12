import express from "express";
import { publicRouter } from "../routes/publicApi";
import { healthRouter } from "../routes/health";
import { errorMiddleware } from "../middlewares/error.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";
import { apiRouter } from "../routes/api";
import cookieParser from "cookie-parser";
import { refreshToken } from "../middlewares/refreshToken.middleware";

export const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(cookieParser(process.env.SECRET_KEY_COOKIE));
app.use(healthRouter);
app.use(publicRouter);
app.use(authMiddleware);
app.use(refreshToken)
app.use(apiRouter);
app.use(errorMiddleware);
