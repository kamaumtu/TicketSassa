import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiService, BookingPass, BookingResult, OrderPayload, TicketTier, EventData } from './services/api.service';

export interface FlightItem {
  id: string;
  airline: string;
  flightNumber: string;
  aircraft: string;
  origin: string;
  originCity: string;
  dest: string;
  destCity: string;
  depTime: string;
  arrTime: string;
  durationText: string;
  stops: string;
  baggage: string;
  amenities: string;
  priceKes: number;
  priceUsd: number;
  seatsLeft: number;
}

export interface HolidayItem {
  id: string;
  title: string;
  resortName: string;
  destination: string;
  duration: string;
  rateKes: number;
  rateUsd: number;
  discount: string;
  mealPlan: string;
  inclusions: string[];
}

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

  // Active Tab
  activeTab: 'events' | 'flights' | 'holidays' | 'wallet' = 'events';

  // Application State
  currency: 'KES' | 'USD' = 'KES';
  event: EventData | null = null;
  ticketTiers: TicketTier[] = [];
  quantities: { [key: string]: number } = {
    regular: 0,
    paddock: 0,
    vip: 0,
    vvip: 0
  };

  // Flights State
  tripType: 'round' | 'one' = 'round';
  flightOrigin = 'NBO';
  flightDest = 'MBA';
  flightDate = '2026-11-20';
  selectedAirline = 'all';
  flightBookingSuccess = '';

  flightsList: FlightItem[] = [
    {
      id: 'KQ604',
      airline: 'Kenya Airways',
      flightNumber: 'KQ 604',
      aircraft: 'Embraer E190',
      origin: 'NBO',
      originCity: 'Nairobi (JKIA)',
      dest: 'MBA',
      destCity: 'Mombasa (Moi Intl)',
      depTime: '08:00',
      arrTime: '09:00',
      durationText: '1h 00m',
      stops: 'Non-Stop',
      baggage: '23kg Check-in + 7kg Cabin',
      amenities: 'Complimentary Refreshment & Tea',
      priceKes: 7850,
      priceUsd: 60,
      seatsLeft: 8
    },
    {
      id: 'JM8602',
      airline: 'Jambojet',
      flightNumber: 'JM 8602',
      aircraft: 'Dash 8-Q400',
      origin: 'NBO',
      originCity: 'Nairobi (JKIA)',
      dest: 'MBA',
      destCity: 'Mombasa (Moi Intl)',
      depTime: '06:30',
      arrTime: '07:30',
      durationText: '1h 00m',
      stops: 'Non-Stop',
      baggage: '10kg Hand Luggage',
      amenities: 'Early Bird Special Fare',
      priceKes: 5900,
      priceUsd: 45,
      seatsLeft: 14
    },
    {
      id: 'OW214',
      airline: 'Skyward Express',
      flightNumber: 'OW 214',
      aircraft: 'Fokker 50',
      origin: 'WIL',
      originCity: 'Nairobi (Wilson)',
      dest: 'MBA',
      destCity: 'Mombasa (Moi Intl)',
      depTime: '09:30',
      arrTime: '10:45',
      durationText: '1h 15m',
      stops: 'Non-Stop',
      baggage: '15kg Check-in + 5kg Cabin',
      amenities: 'Scenic Coastal Approach',
      priceKes: 6800,
      priceUsd: 52,
      seatsLeft: 6
    },
    {
      id: '5H402',
      airline: 'Fly540',
      flightNumber: '5H 402',
      aircraft: 'Bombardier CRJ-200',
      origin: 'NBO',
      originCity: 'Nairobi (JKIA)',
      dest: 'KIS',
      destCity: 'Kisumu Intl',
      depTime: '14:15',
      arrTime: '15:10',
      durationText: '55m',
      stops: 'Non-Stop',
      baggage: '20kg Check-in',
      amenities: 'Lake Victoria Express',
      priceKes: 6200,
      priceUsd: 48,
      seatsLeft: 11
    }
  ];

  // Holidays State
  holidaysList: HolidayItem[] = [
    {
      id: 'neptune-village',
      title: '5 Days 4 Nights At Neptune Village Beach Resort & Spa',
      resortName: 'Neptune Village Beach Resort',
      destination: 'Diani Beach, South Coast, Kenya',
      duration: '5D / 4N',
      rateKes: 67760,
      rateUsd: 520,
      discount: '72% OFF',
      mealPlan: 'All-Inclusive (Breakfast, Lunch, Dinner, Drinks)',
      inclusions: [
        'Superior Makuti-roof garden room',
        'Unlimited selected alcoholic & soft beverages',
        'Free return transfers from Ukunda Airstrip',
        '2 large freshwater swimming pools & beach direct access'
      ]
    },
    {
      id: 'sarova-mara',
      title: '3 Days 2 Nights Luxury Safari at Sarova Mara Game Camp',
      resortName: 'Sarova Mara Game Camp',
      destination: 'Maasai Mara National Reserve, Kenya',
      duration: '3D / 2N',
      rateKes: 54900,
      rateUsd: 420,
      discount: 'Best Value Safari',
      mealPlan: 'Full Board (All Gourmet Meals Included)',
      inclusions: [
        'Luxury Club Safari Tent with panoramic private deck',
        'Unlimited game drives across Mara triangle with expert guide',
        'Sundowner cocktails overlooking Isungeta stream',
        'Nightly Maasai cultural dance and acoustic campfire fireside'
      ]
    },
    {
      id: 'prideinn-flamingo',
      title: '4 Days 3 Nights Coastal Escape at PrideInn Flamingo Beach',
      resortName: 'PrideInn Flamingo Beach Resort',
      destination: 'Shanzu Beach, North Coast Mombasa',
      duration: '4D / 3N',
      rateKes: 42500,
      rateUsd: 325,
      discount: 'All-Inclusive Deal',
      mealPlan: 'All-Inclusive (Full Dining & Selected Beverages)',
      inclusions: [
        'Cascade swimming pool with swim-up cocktail bar',
        'Direct Shanzu white sand beach access',
        'Water volleyball, aqua-aerobics, and kids club',
        'Themed dinner buffets with live coastal band entertainment'
      ]
    }
  ];

  // Checkout & Customer Data
  isCheckoutOpen = false;
  isPassModalOpen = false;
  customerName = 'Kamau Mwangi';
  customerEmail = 'kamau@example.com';
  customerPhone = '0712345678';
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

  ngOnInit() {
    this.loadBackendData();
  }

  loadBackendData() {
    // 1. Load Event
    this.api.getFeaturedEvent().subscribe({
      next: (res) => this.event = res.data,
      error: () => { this.event = null; }
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

  switchTab(tab: 'events' | 'flights' | 'holidays' | 'wallet') {
    this.activeTab = tab;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  toggleCurrency() {
    this.currency = this.currency === 'KES' ? 'USD' : 'KES';
  }

  updateQty(tierKey: string, change: number) {
    const current = this.quantities[tierKey] || 0;
    const stock = this.ticketTiers.find(tier => tier.tierKey === tierKey)?.remainingAllocation ?? 100;
    this.quantities[tierKey] = Math.min(stock, 100, Math.max(0, current + change));
  }

  get totalTicketsCount(): number {
    const tickets = Object.values(this.quantities).reduce((acc, q) => acc + q, 0);
    return tickets;
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

  get filteredFlights(): FlightItem[] {
    return this.flightsList.filter(f => {
      const matchAirline = this.selectedAirline === 'all' || f.airline.toLowerCase().includes(this.selectedAirline.toLowerCase());
      const matchRoute = (!this.flightOrigin || f.origin === this.flightOrigin) && (!this.flightDest || f.dest === this.flightDest);
      return matchAirline && matchRoute;
    });
  }

  bookFlightDemo(flight: FlightItem) {
    this.flightBookingSuccess = `E-Ticket reserved on ${flight.airline} (${flight.flightNumber}): ${flight.origin} → ${flight.dest}. Booking confirmation sent to ${this.customerEmail}.`;
    setTimeout(() => {
      this.flightBookingSuccess = '';
    }, 8000);
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
    this.paymentStatusMessage = 'Preparing your order…';

    const payload: OrderPayload = {
      customer: { name: this.customerName, email: this.customerEmail, phone: this.customerPhone },
      items: Object.entries(this.quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([tierKey, quantity]) => ({ tierKey, quantity })),
      currency: this.currency,
      paymentMethod: 'MPESA'
    };
    try {
      const { mode } = await firstValueFrom(this.api.checkoutMode().pipe(timeout(15000)));
      if (mode === 'unavailable') throw new Error('Online checkout is currently unavailable.');
      if (mode === 'live') payload.currency = 'KES';
      const fingerprint = JSON.stringify(payload);
      if (this.pendingOrder?.fingerprint !== fingerprint) {
        const order = await firstValueFrom(this.api.createOrder(payload).pipe(timeout(15000)));
        this.pendingOrder = { fingerprint, reference: order.data.orderReference };
      }
      const reference = this.pendingOrder.reference;
      this.orderReference = reference;
      this.orderEmail = this.customerEmail;
      const payment = await firstValueFrom(this.api.initiateMpesaStkPush(reference, this.customerPhone).pipe(timeout(30000)));
      let result!: BookingResult;
      if (payment.mode === 'demo') {
        result = await firstValueFrom(this.api.confirmDemo(reference, payment.CheckoutRequestID || payment.checkoutRequestId || '').pipe(timeout(15000)));
      } else {
        this.paymentStatusMessage = payment.CustomerMessage || 'Approve the prompt on your phone.';
        let confirmed = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 3500));
          const check = await firstValueFrom(this.api.checkPaymentStatus(reference).pipe(timeout(10000))).catch(() => null);
          if (check?.status === 'COMPLETED') {
            result = { data: check.order, passes: check.passes || [] };
            confirmed = true;
            break;
          }
          if (check?.status === 'FAILED') {
            this.pendingOrder = undefined;
            throw new Error(check.reason || 'Payment was declined or cancelled on your mobile phone.');
          }
          this.paymentStatusMessage = `Awaiting payment confirmation (${attempt + 1}/15)...`;
        }
        if (!confirmed) {
          result = await firstValueFrom(this.api.lookupOrder(reference, this.customerEmail).pipe(timeout(12000)));
          if (result.data.paymentStatus !== 'COMPLETED') {
            throw new Error(`Payment processing. Check order ${reference} in My tickets.`);
          }
        }
      }
      this.pendingOrder = undefined;
      this.orderEmail = this.customerEmail;
      this.setBooking(result);
    } catch (err: any) {
      if ([410, 422].includes(err?.status)) this.pendingOrder = undefined;
      this.paymentStatusMessage = err?.error?.message || err?.message || 'The payment request failed.';
    } finally {
      this.isProcessingPayment = false;
    }
  }

  setBooking(result: BookingResult) {
    this.savedPasses = result.passes;
    this.orderReference = result.data.orderReference;
    this.orderStatus = `Order ${result.data.orderReference} ${result.data.paymentStatus}`;
    if (result.passes.length > 0) {
      this.issuedDigitalPass = result.passes[0];
      this.isPassModalOpen = true;
    }
    this.closeCheckout();
    this.quantities = { regular: 0, paddock: 0, vip: 0, vvip: 0 };
  }

  async lookupOrder() {
    if (!this.orderReference || !this.orderEmail) return;
    this.isLookingUp = true;
    this.orderStatus = 'Looking up order passes...';
    try {
      const res = await firstValueFrom(this.api.lookupOrder(this.orderReference, this.orderEmail).pipe(timeout(30000)));
      this.savedPasses = res.passes;
      this.orderStatus = `Order ${res.data.orderReference} - ${res.data.paymentStatus} · ${res.passes.length} passes.`;
    } catch (err: any) {
      this.orderStatus = err?.error?.message || 'Could not find order. Please verify reference and email.';
    } finally {
      this.isLookingUp = false;
    }
  }

  viewPass(pass: BookingPass) {
    this.issuedDigitalPass = pass;
    this.isPassModalOpen = true;
  }
}
