import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CreateMinimalBookingDto } from './dto/create-minimal-booking.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CreateCustomerWithBookingDto } from './dto/create-customer-with-booking.dto';
import { AddBookingDto } from './dto/add-booking.dto';
import { AssignStrikeDto, ToggleSuspensionDto } from './dto/customer-actions.dto';
import { UploadCustomerDocumentDto } from './dto/customer-document.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermission('can_view_customers')
  async findAll(@CurrentSession() session: any) {
    return this.customersService.findAll(session);
  }

  /**
   * 1. POST /customers/minimal-booking
   * Sub Admin Quick Booking Flow (3 fields, minimal registration status, immediate plot commit).
   */
  @Post('minimal-booking')
  async createMinimalBooking(
    @Body() dto: CreateMinimalBookingDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.createMinimalBooking(dto, session);
  }

  /**
   * 3. POST /customers (Path A)
   * Create new Customer account and attach first Plot Booking.
   */
  @Post()
  async createCustomerWithBooking(
    @Body() dto: CreateCustomerWithBookingDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.createCustomerWithBooking(dto, session);
  }

  /**
   * 2. POST /customers/:id/complete-registration
   * Super Admin Action: Complete Member Registration (issues membershipNo, official schedule, password).
   */
  @Post(':id/complete-registration')
  async completeMemberRegistration(
    @Param('id') id: string,
    @Body() dto: CompleteRegistrationDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.completeMemberRegistration(id, dto, session);
  }

  /**
   * 4. POST /customers/:id/bookings (Path B)
   * Add additional Plot Booking to an existing customer account.
   */
  @Post(':id/bookings')
  async addBookingToCustomer(
    @Param('id') id: string,
    @Body() dto: AddBookingDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.addBookingToCustomer(id, dto, session);
  }

  /**
   * 5. POST /customers/:id/strikes
   * Assign an administrative strike to a customer.
   */
  @Post(':id/strikes')
  async assignStrike(
    @Param('id') id: string,
    @Body() dto: AssignStrikeDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.assignStrike(id, dto, session);
  }

  /**
   * 6. POST /customers/:id/suspend
   * Suspend or reactivate a Customer account. Gated by can_view_customers.
   */
  @Post(':id/suspend')
  @RequirePermission('can_view_customers')
  async toggleSuspension(
    @Param('id') id: string,
    @Body() dto: ToggleSuspensionDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.toggleSuspension(id, dto, session);
  }

  @Post(':id/documents')
  async uploadDocument(
    @Param('id') customerId: string,
    @Body() dto: UploadCustomerDocumentDto,
    @CurrentSession() session: any,
  ) {
    return this.customersService.uploadDocument(customerId, dto, session);
  }

  @Delete('documents/:docId')
  async deleteDocumentDirect(
    @Param('docId') docId: string,
    @CurrentSession() session: any,
  ) {
    return this.customersService.deleteDocument(null, docId, session);
  }

  @Delete(':id/documents/:docId')
  async deleteDocument(
    @Param('id') customerId: string,
    @Param('docId') docId: string,
    @CurrentSession() session: any,
  ) {
    return this.customersService.deleteDocument(customerId, docId, session);
  }

  @Post(':id/accept-terms')
  async acceptTerms(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.customersService.acceptTerms(id, session);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentSession() session: any) {
    return this.customersService.findOne(id, session);
  }
}
