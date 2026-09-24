import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { Prisma } from '@prisma/client';
import MobilityService, { Bounds, LocationInput } from './mobility.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

const vehicleTypeSchema = Joi.object({
  code: Joi.string()
    .uppercase()
    .pattern(/^[A-Z0-9_]+$/)
    .required(),
  name: Joi.string().required(),
  markerIconUrl: Joi.string().uri().allow(null),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer(),
});

const operatorSchema = Joi.object({
  name: Joi.string().required(),
  isActive: Joi.boolean(),
});

const memberSchema = Joi.object({
  userId: Joi.string().required(),
  role: Joi.string().valid('OPERATOR_ADMIN', 'DRIVER').required(),
});

const vehicleSchema = Joi.object({
  operatorId: Joi.string().required(),
  vehicleTypeId: Joi.string().required(),
  plateNumber: Joi.string().trim().uppercase().required(),
  driverUserId: Joi.string().allow(null),
  trackingEnabled: Joi.boolean(),
});

/** PATCH bodies: same fields, none required, at least one present. */
const partial = (schema: Joi.ObjectSchema) =>
  schema.fork(Object.keys(schema.describe().keys), (key) => key.optional()).min(1);

const boundsSchema = Joi.object({
  north: Joi.number().min(-90).max(90).required(),
  south: Joi.number().min(-90).max(90).required(),
  east: Joi.number().min(-180).max(180).required(),
  west: Joi.number().min(-180).max(180).required(),
});

// Built per request: the accepted timestamp window moves with the clock.
const locationSchema = () =>
  Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    speed: Joi.number().min(0).max(160).allow(null), // km/h
    heading: Joi.number().min(0).max(360).allow(null),
    timestamp: Joi.number()
      .integer()
      .min(Date.now() - 30_000)
      .max(Date.now() + 5_000)
      .required(),
  });

type Handler = (req: Request, res: Response) => Promise<unknown>;

const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

/** Runs `use` with the validated input, or answers 422. */
const withValid =
  <T>(
    schema: Joi.Schema | (() => Joi.Schema),
    pick: (req: Request) => unknown,
    use: (value: T, req: Request, res: Response) => Promise<unknown>,
  ): Handler =>
  async (req, res) => {
    const s = typeof schema === 'function' ? schema() : schema;
    const { error, value } = s.validate(pick(req), { abortEarly: false, stripUnknown: true });
    if (error) return responseError(res, 422, error.message);
    return use(value as T, req, res);
  };

const body = (req: Request) => req.body;
const userId = (req: Request) => req.user!.id;

export default class MobilityController {
  static listVehicleTypes = handle(async (_req, res) =>
    responseSuccess(res, 200, await MobilityService.listVehicleTypes()),
  );

  static createVehicleType = handle(
    withValid(vehicleTypeSchema, body, async (v: Prisma.VehicleTypesCreateInput, _req, res) =>
      responseSuccess(res, 201, await MobilityService.createVehicleType(v)),
    ),
  );

  static updateVehicleType = handle(
    withValid(
      partial(vehicleTypeSchema),
      body,
      async (v: Prisma.VehicleTypesUpdateInput, req, res) =>
        responseSuccess(res, 200, await MobilityService.updateVehicleType(req.params.id, v)),
    ),
  );

  static listOperators = handle(async (_req, res) =>
    responseSuccess(res, 200, await MobilityService.listOperators()),
  );

  static createOperator = handle(
    withValid(operatorSchema, body, async (v: Prisma.TransportOperatorsCreateInput, _req, res) =>
      responseSuccess(res, 201, await MobilityService.createOperator(v)),
    ),
  );

  static updateOperator = handle(
    withValid(
      partial(operatorSchema),
      body,
      async (v: Prisma.TransportOperatorsUpdateInput, req, res) =>
        responseSuccess(res, 200, await MobilityService.updateOperator(req.params.id, v)),
    ),
  );

  static addOperatorMember = handle(
    withValid(memberSchema, body, async (v: { userId: string; role: string }, req, res) =>
      responseSuccess(
        res,
        200,
        await MobilityService.addOperatorMember(req.params.id, v.userId, v.role),
      ),
    ),
  );

  static listVehicles = handle(async (_req, res) =>
    responseSuccess(res, 200, await MobilityService.listVehicles()),
  );

  static createVehicle = handle(
    withValid(vehicleSchema, body, async (v: Prisma.VehiclesUncheckedCreateInput, _req, res) =>
      responseSuccess(res, 201, await MobilityService.createVehicle(v)),
    ),
  );

  static updateVehicle = handle(
    withValid(
      partial(vehicleSchema),
      body,
      async (v: Prisma.VehiclesUncheckedUpdateInput, req, res) =>
        responseSuccess(res, 200, await MobilityService.updateVehicle(req.params.id, v)),
    ),
  );

  static myVehicle = handle(async (req, res) =>
    responseSuccess(res, 200, await MobilityService.getDriverVehicle(userId(req))),
  );

  static recordLocation = handle(
    withValid(locationSchema, body, async (v: LocationInput, req, res) =>
      responseSuccess(res, 200, await MobilityService.recordLocation(userId(req), v)),
    ),
  );

  static stopTracking = handle(async (req, res) => {
    await MobilityService.stopTracking(userId(req));
    return responseSuccess(res, 200, null);
  });

  static liveVehicles = handle(
    withValid(
      boundsSchema,
      (req) => req.query,
      async (v: Bounds, _req, res) => responseSuccess(res, 200, MobilityService.liveInBounds(v)),
    ),
  );
}
