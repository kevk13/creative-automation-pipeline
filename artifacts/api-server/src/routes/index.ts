import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import campaignRouter from "./campaign.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(campaignRouter);

export default router;
