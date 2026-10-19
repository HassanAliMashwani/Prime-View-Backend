import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @Public()
  async submitInquiry(
    @Body()
    body: {
      name?: string;
      phone?: string;
      message?: string;
      consent?: boolean;
    },
  ) {
    const name = body?.name?.trim();
    const phone = body?.phone?.trim();
    const message = body?.message?.trim();
    const consent = body?.consent;

    if (!name || name.length < 2) {
      throw new BadRequestException('Please provide a valid name (at least 2 characters).');
    }
    const phoneDigits = (phone || '').replace(/\D/g, '');
    if (!phone || phoneDigits.length < 8) {
      throw new BadRequestException('Please provide a valid phone number.');
    }
    if (phoneDigits.length > 11) {
      throw new BadRequestException('Phone number cannot be greater than 11 digits.');
    }
    if (!message || message.length < 5) {
      throw new BadRequestException('Please provide an inquiry message.');
    }
    if (!consent) {
      throw new BadRequestException('Consent is required to submit an inquiry.');
    }

    const inquiryId = `inq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.prisma.$executeRaw`
      INSERT INTO "Inquiry" ("id", "name", "phone", "message", "consent", "createdAt")
      VALUES (${inquiryId}, ${name}, ${phone}, ${message}, ${Boolean(consent)}, NOW())
    `;

    return {
      ok: true,
      message: 'Your inquiry has been received',
      inquiryId,
    };
  }
}
