import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, timeout } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService, BookingPass, BookingResult, OrderPayload, StadiumZone, TicketTier, EventData } from './services/api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  private api = inject(ApiService);

  // Application State
  currency: 'KES' | 'USD' = 'KES';
  event: EventData | null = null;
  zones: StadiumZone[] = [];
  selectedZone: StadiumZone | null = null;
  ticketTiers: TicketTier[] = [];
  quantities: { [key: string]: number } = {
    regular: 0,
    paddock: 0,
    vip: 0,
    vvip: 0
  };

  // Checkout & Customer Data
  isCheckoutOpen = false;
  isPassModalOpen = false;
  customerName = '';
  customerEmail = '';
  customerPhone = '';
  isProcessingPayment = false;
  paymentStatusMessage = '';
  issuedDigitalPass: BookingPass | null = null;
  savedPasses: BookingPass[] = [];
  orderReference = '';
  orderEmail = '';
  orderStatus = '';
  catalogStatus = '';
  isLookingUp = false;
  private pendingOrder?: { fingerprint: string; reference: string };

  // Audio preview toggle
  isPlayingAudio = false;

  ngOnInit() {
    this.loadBackendData();
  }

  loadBackendData() {
    // 1. Load Event
    this.api.getFeaturedEvent().subscribe({
      next: (res) => this.event = res.data,
      error: () => { this.event = null; }
    });

    // 2. Load Zones
    this.api.getStadiumZones().subscribe({
      next: (res) => {
        this.zones = res.data;
        if (this.zones.length > 0) {
          this.selectedZone = this.zones[0];
        }
      }
    });

    // 3. Load Ticket Tiers
    this.api.getTicketTiers().subscribe({
      next: (res) => {
        this.ticketTiers = res.data;
        this.catalogStatus = res.data.length ? '' : 'No ticket tiers are available.';
      },
      error: () => { this.catalogStatus = 'Could not load ticket tiers. Refresh to try again.'; }
    });
  }

  toggleCurrency() {
    this.currency = this.currency === 'KES' ? 'USD' : 'KES';
  }

  selectZone(zoneKey: string) {
    const found = this.zones.find(z => z.zoneKey === zoneKey);
    if (found) {
      this.selectedZone = found;
    }
  }

  updateQty(tierKey: string, change: number) {
    const current = this.quantities[tierKey] || 0;
    const stock = this.ticketTiers.find(tier => tier.tierKey === tierKey)?.remainingAllocation ?? 0;
    this.quantities[tierKey] = Math.min(stock, 100, Math.max(0, current + change));
  }

  get totalTicketsCount(): number {
    return Object.values(this.quantities).reduce((acc, q) => acc + q, 0);
  }

  get cartTotal(): number {
    let total = 0;
    for (const tier of this.ticketTiers) {
      const q = this.quantities[tier.tierKey] || 0;
      const unit = this.currency === 'KES' ? tier.priceKes : tier.priceUsd;
      total += q * unit;
    }
    return total;
  }

  openCheckout() {
    if (this.totalTicketsCount === 0) return;
    this.paymentStatusMessage = '';
    this.isCheckoutOpen = true;
  }

  closeCheckout() {
    this.isCheckoutOpen = false;
  }

  async triggerMpesaCheckout() {
    if (this.isProcessingPayment) return;
    this.isProcessingPayment = true;
    this.paymentStatusMessage = 'Creating your demo order?';

    const payload: OrderPayload = {
      customer: { name: this.customerName, email: this.customerEmail, phone: this.customerPhone },
      items: Object.entries(this.quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([tierKey, quantity]) => ({ tierKey, quantity })),
      currency: this.currency,
      paymentMethod: 'MPESA'
    };
    const fingerprint = JSON.stringify(payload);

    try {
      if (this.pendingOrder?.fingerprint !== fingerprint) {
        const order = await firstValueFrom(this.api.createOrder(payload).pipe(timeout(15000)));
        this.pendingOrder = { fingerprint, reference: order.data.orderReference };
      }
      const reference = this.pendingOrder.reference;
      this.paymentStatusMessage = 'Completing your demo payment?';
      const payment = await firstValueFrom(this.api.initiateMpesaStkPush(reference, this.customerPhone).pipe(timeout(15000)));
      const result = await firstValueFrom(this.api.confirmDemo(reference, payment.CheckoutRequestID).pipe(timeout(15000)));
      this.pendingOrder = undefined;
      this.orderEmail = this.customerEmail;
      this.setBooking(result);
      this.isCheckoutOpen = false;
      if (this.savedPasses.length) this.showPass(this.savedPasses[0]);
      for (const key of Object.keys(this.quantities)) this.quantities[key] = 0;
      this.loadBackendData();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 410) this.pendingOrder = undefined;
      this.paymentStatusMessage = this.bookingError(error);
    } finally {
      this.isProcessingPayment = false;
    }
  }

  async lookupOrder() {
    if (this.isLookingUp) return;
    this.isLookingUp = true;
    this.orderStatus = 'Looking up your order?';
    this.savedPasses = [];
    try {
      const result = await firstValueFrom(this.api.lookupOrder(this.orderReference, this.orderEmail).pipe(timeout(15000)));
      this.setBooking(result);
    } catch (error) {
      this.orderStatus = this.bookingError(error);
    } finally {
      this.isLookingUp = false;
    }
  }

  showPass(pass: BookingPass) {
    this.issuedDigitalPass = pass;
    this.isPassModalOpen = true;
  }

  passQrUrl(token: string) {
    return this.api.passQrUrl(token);
  }

  private setBooking(result: BookingResult) {
    this.orderReference = result.data.orderReference;
    this.savedPasses = result.passes;
    this.orderStatus = (result.data.mode === 'demo' ? 'Demo order: ' : 'Order: ') +
      result.data.paymentStatus.toLowerCase();
  }

  private bookingError(error: unknown) {
    return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message : 'Could not reach the booking service. Try again.';
  }

  closePassModal() {
    this.isPassModalOpen = false;
  }

  toggleAudio() {
    this.isPlayingAudio = !this.isPlayingAudio;
  }
}

