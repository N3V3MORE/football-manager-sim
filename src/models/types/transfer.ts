export type NegotiationStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired';

export type TransferNegotiationSource = 'unlisted_approach' | 'listed_offer';

export interface RivalBid {
  teamId: string;
  bid: number;
  expiresWeek: number;
  status: 'active' | 'matched' | 'won' | 'lost' | 'expired';
}

export interface TransferNegotiation {
  id: string;
  playerId: string;
  buyerTeamId: string;
  sellerTeamId: string;
  currentBid: number;
  currentWage: number;
  askingPrice: number;
  round: number;
  status: NegotiationStatus;
  createdWeek: number;
  expiresWeek: number;
  source: TransferNegotiationSource;
  rivalBid?: RivalBid;
}
