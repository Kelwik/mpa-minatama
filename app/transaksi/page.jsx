'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { AppSidebar } from '@/components/app-sidebar';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export default function Transaksi() {
  const [user, setUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [lobsterTypes, setLobsterTypes] = useState([]);
  const [weightClasses, setWeightClasses] = useState([]);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    lobsterType: 'all',
    transactionType: 'all',
    page: 1,
  });
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [incomingStock, setIncomingStock] = useState(0);
  const [outgoingStock, setOutgoingStock] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [editForm, setEditForm] = useState({
    transaction_type: '',
    type_id: '',
    weight_class_id: '',
    quantity: '',
    transaction_date: '',
    destination: '',
    notes: '',
  });

  const transactionTypes = ['ADD', 'DISTRIBUTE', 'DEATH', 'DAMAGED'];

  // Check authentication
  useEffect(() => {
    const fetchSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);
    };
    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => authListener.subscription?.unsubscribe();
  }, []);

  // Fetch lobster types and weight classes
  const fetchReferenceData = async () => {
    try {
      const [lobsterTypesRes, weightClassesRes] = await Promise.all([
        supabase.from('lobster_types').select('id, name').order('name'),
        supabase
          .from('weight_classes')
          .select('id, weight_range')
          .order('weight_range'),
      ]);

      if (lobsterTypesRes.error) throw lobsterTypesRes.error;
      if (weightClassesRes.error) throw weightClassesRes.error;

      setLobsterTypes(lobsterTypesRes.data);
      setWeightClasses(weightClassesRes.data);
    } catch (error) {
      toast.error('Gagal Memuat Data Referensi', {
        description: error.message,
      });
    }
  };

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setTableLoading(true);
      console.log('Fetching transactions with filters:', filters, {
        itemsPerPage,
      });

      const from = (filters.page - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      const countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      const query = supabase
        .from('transactions')
        .select(
          `
          id,
          transaction_type,
          quantity,
          transaction_date,
          notes,
          destination,
          type_id,
          weight_class_id,
          lobster_types (name),
          weight_classes (weight_range)
        `
        )
        .order('transaction_date', { ascending: false })
        .range(from, to);

      const stockQuery = supabase
        .from('transactions')
        .select('transaction_type, quantity');

      if (filters.startDate) {
        const startISO =
          new Date(filters.startDate).toISOString().split('T')[0] +
          'T00:00:00Z';
        query.gte('transaction_date', startISO);
        countQuery.gte('transaction_date', startISO);
        stockQuery.gte('transaction_date', startISO);
      }
      if (filters.endDate) {
        const endISO =
          new Date(filters.endDate).toISOString().split('T')[0] + 'T23:59:59Z';
        query.lte('transaction_date', endISO);
        countQuery.lte('transaction_date', endISO);
        stockQuery.lte('transaction_date', endISO);
      }
      if (filters.lobsterType !== 'all') {
        const { data: typeData, error: typeError } = await supabase
          .from('lobster_types')
          .select('id')
          .eq('name', filters.lobsterType)
          .single();
        if (typeError || !typeData) {
          console.warn('No lobster type found for:', filters.lobsterType);
          setTransactions([]);
          setTotalItems(0);
          setIncomingStock(0);
          setOutgoingStock(0);
          setTableLoading(false);
          return;
        }
        query.eq('type_id', typeData.id);
        countQuery.eq('type_id', typeData.id);
        stockQuery.eq('type_id', typeData.id);
      }
      if (filters.transactionType !== 'all') {
        query.eq('transaction_type', filters.transactionType);
        countQuery.eq('transaction_type', filters.transactionType);
      }

      const [
        { data, error },
        { count },
        { data: stockData, error: stockError },
      ] = await Promise.all([query, countQuery, stockQuery]);

      if (error || stockError) throw error || stockError;

      const incoming = (stockData || []).reduce((sum, t) => {
        if (t.transaction_type === 'ADD') {
          return sum + (t.quantity || 0);
        }
        return sum;
      }, 0);

      const outgoing = (stockData || []).reduce((sum, t) => {
        if (['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(t.transaction_type)) {
          return sum + Math.abs(t.quantity || 0);
        }
        return sum;
      }, 0);

      console.log('Fetched transactions:', data);
      setTransactions(data || []);
      setTotalItems(count || 0);
      setIncomingStock(incoming);
      setOutgoingStock(outgoing);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setError(error.message);
      toast.error('Gagal Memuat Transaksi', {
        description: error.message,
      });
    } finally {
      setTableLoading(false);
    }
  }, [filters, itemsPerPage]);

  // Open edit modal
  const openEditModal = (transaction) => {
    setEditingTransaction(transaction);
    setEditForm({
      transaction_type: transaction.transaction_type,
      type_id: transaction.type_id,
      weight_class_id: transaction.weight_class_id,
      quantity: transaction.quantity.toString(),
      transaction_date: new Date(transaction.transaction_date)
        .toISOString()
        .split('T')[0],
      destination: transaction.destination || '',
      notes: transaction.notes || '',
    });
    setEditModalOpen(true);
  };

  // Handle edit form change
  const handleEditFormChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  // Validate stock for ADD transactions
  const validateStock = async (
    transactionId,
    typeId,
    weightClassId,
    newQuantity
  ) => {
    const { data, error } = await supabase
      .from('transactions')
      .select('quantity')
      .eq('type_id', typeId)
      .eq('weight_class_id', weightClassId)
      .in('transaction_type', ['DISTRIBUTE', 'DEATH', 'DAMAGED']);

    if (error) throw error;

    const totalOutgoing = (data || []).reduce(
      (sum, t) => sum + Math.abs(t.quantity),
      0
    );
    const currentAdd = transactions
      .filter(
        (t) =>
          t.id !== transactionId &&
          t.transaction_type === 'ADD' &&
          t.type_id === typeId &&
          t.weight_class_id === weightClassId
      )
      .reduce((sum, t) => sum + t.quantity, 0);

    if (newQuantity + currentAdd < totalOutgoing) {
      throw new Error(
        `Jumlah tidak cukup. Total keluar: ${totalOutgoing}, total masuk lainnya: ${currentAdd}.`
      );
    }
  };

  // Submit edit form
  const handleEditSubmit = async () => {
    if (!editingTransaction) return;

    try {
      // Validate inputs
      if (!editForm.transaction_type) {
        throw new Error('Jenis transaksi diperlukan');
      }
      if (!editForm.type_id) {
        throw new Error('Jenis lobster diperlukan');
      }
      if (!editForm.weight_class_id) {
        throw new Error('Kelas berat diperlukan');
      }
      if (
        !editForm.quantity ||
        isNaN(editForm.quantity) ||
        Number(editForm.quantity) <= 0
      ) {
        throw new Error('Jumlah harus lebih dari 0');
      }
      if (!editForm.transaction_date) {
        throw new Error('Tanggal transaksi diperlukan');
      }

      // Validate stock for ADD transactions
      if (editingTransaction.transaction_type === 'ADD') {
        await validateStock(
          editingTransaction.id,
          editForm.type_id,
          editForm.weight_class_id,
          Number(editForm.quantity)
        );
      }

      const { error } = await supabase
        .from('transactions')
        .update({
          transaction_type: editForm.transaction_type,
          type_id: editForm.type_id,
          weight_class_id: editForm.weight_class_id,
          quantity: Number(editForm.quantity),
          transaction_date: new Date(editForm.transaction_date).toISOString(),
          destination: editForm.destination || null,
          notes: editForm.notes || null,
        })
        .eq('id', editingTransaction.id);

      if (error) throw error;

      toast.success('Transaksi Berhasil Diperbarui');
      setEditModalOpen(false);
      setEditingTransaction(null);
      // Real-time subscription will trigger fetchTransactions
    } catch (error) {
      toast.error('Gagal Memperbarui Transaksi', {
        description: error.message,
      });
    }
  };

  // Normalize destination
  const getDestinationDisplay = useCallback((destination) => {
    return destination || 'Tidak Ada';
  }, []);

  // Normalize notes
  const getNotesDisplay = useCallback((notes) => {
    if (!notes) return 'Tidak Ada';
    if (typeof notes === 'string') return notes;
    if (typeof notes === 'object')
      return notes.note || JSON.stringify(notes) || 'Tidak Ada';
    return 'Tidak Ada';
  }, []);

  // Get transaction type color
  const getTransactionColor = useCallback((type) => {
    switch (type) {
      case 'ADD':
        return 'text-green-500';
      case 'DISTRIBUTE':
        return 'text-red-500';
      case 'DEATH':
        return 'text-gray-500';
      case 'DAMAGED':
        return 'text-orange-500';
      default:
        return 'text-gray-900 dark:text-gray-100';
    }
  }, []);

  // Map transaction types to Bahasa Indonesia
  const transactionTypeDisplay = {
    ADD: 'Penambahan',
    DISTRIBUTE: 'Distribusi',
    DEATH: 'Kematian',
    DAMAGED: 'Kerusakan',
    all: 'Semua Jenis Transaksi',
  };

  // Export transactions to PDF
  const exportToPDF = useCallback(async () => {
    if (transactions.length === 0) {
      toast.warning('Tidak Ada Transaksi', {
        description: 'Tidak ada transaksi untuk diekspor.',
      });
      return;
    }

    try {
      const doc = new jsPDF();
      const filterText = [
        filters.startDate
          ? `Dari: ${format(new Date(filters.startDate), 'dd MMMM yyyy', {
              locale: id,
            })}`
          : '',
        filters.endDate
          ? `Sampai: ${format(new Date(filters.endDate), 'dd MMMM yyyy', {
              locale: id,
            })}`
          : '',
        filters.lobsterType !== 'all'
          ? `Jenis Lobster: ${filters.lobsterType}`
          : 'Jenis Lobster: Semua',
        filters.transactionType !== 'all'
          ? `Jenis Transaksi: ${
              transactionTypeDisplay[filters.transactionType]
            }`
          : '',
        `Lobster Masuk: ${incomingStock} Ekor | Lobster Keluar: ${outgoingStock} Ekor`,
      ]
        .filter(Boolean)
        .join(' | ');

      doc.text('Riwayat Transaksi', 14, 20);
      const maxWidth = 180;
      const wrappedText = doc.splitTextToSize(filterText, maxWidth);
      console.log('PDF filter text:', wrappedText);
      wrappedText.forEach((line, index) => {
        doc.text(line, 14, 27 + index * 5);
      });

      const query = supabase
        .from('transactions')
        .select(
          `
          transaction_type,
          quantity,
          transaction_date,
          notes,
          destination,
          lobster_types (name),
          weight_classes (weight_range)
        `
        )
        .order('transaction_date', { ascending: false });

      if (filters.startDate) {
        const startISO =
          new Date(filters.startDate).toISOString().split('T')[0] +
          'T00:00:00Z';
        query.gte('transaction_date', startISO);
      }
      if (filters.endDate) {
        const endISO =
          new Date(filters.endDate).toISOString().split('T')[0] + 'T23:59:59Z';
        query.lte('transaction_date', endISO);
      }
      if (filters.lobsterType !== 'all') {
        const { data: typeData, error: typeError } = await supabase
          .from('lobster_types')
          .select('id')
          .eq('name', filters.lobsterType)
          .single();
        if (typeError || !typeData) {
          throw new Error(
            `Jenis lobster "${filters.lobsterType}" tidak ditemukan`
          );
        }
        query.eq('type_id', typeData.id);
      }
      if (filters.transactionType !== 'all') {
        query.eq('transaction_type', filters.transactionType);
      }

      const { data, error } = await query;
      if (error) throw error;

      autoTable(doc, {
        startY: 27 + wrappedText.length * 5 + 7,
        head: [
          [
            'Jenis',
            'Lobster',
            'Berat',
            'Jumlah',
            'Tujuan/Asal',
            'Catatan',
            'Tanggal',
          ],
        ],
        body: (data || []).map((t) => [
          transactionTypeDisplay[t.transaction_type] || 'Tidak Diketahui',
          t.lobster_types?.name || 'Tidak Ada',
          `${t.weight_classes?.weight_range} gram` || 'Tidak Ada',
          `${Math.abs(t.quantity) ?? 0} Ekor`,
          getDestinationDisplay(t.destination),
          getNotesDisplay(t.notes),
          t.transaction_date
            ? format(new Date(t.transaction_date), 'dd MMMM yyyy', {
                locale: id,
              })
            : 'Tidak Ada',
        ]),
        foot: [
          [
            '',
            '',
            '',
            `Lobster Masuk: ${incomingStock} Ekor | Lobster Keluar: ${outgoingStock} Ekor`,
            '',
            '',
            '',
          ],
        ],
        styles: { fontSize: 10, cellPadding: 2, textColor: [33, 33, 33] },
        headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255] },
      });

      const filenameParts = ['transaksi'];
      if (filters.startDate || filters.endDate) {
        const start = filters.startDate
          ? format(new Date(filters.startDate), 'yyyyMMdd')
          : 'tanpa_tanggal_mulai';
        const end = filters.endDate
          ? format(new Date(filters.endDate), 'yyyyMMdd')
          : 'tanpa_tanggal_selesai';
        filenameParts.push(`${start}-${end}`);
      }
      if (filters.lobsterType !== 'all') {
        filenameParts.push(
          filters.lobsterType
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_-]/g, '')
        );
      } else {
        filenameParts.push('SemuaJenis');
      }
      if (filters.transactionType !== 'all') {
        filenameParts.push(filters.transactionType);
      } else {
        filenameParts.push('SemuaTransaksi');
      }
      const filename = `${filenameParts.join('_')}.pdf`;

      doc.save(filename);
      toast.success('PDF Berhasil Diunduh', {
        description: `Riwayat transaksi disimpan sebagai ${filename}`,
      });
    } catch (error) {
      toast.error('Ekspor PDF Gagal', {
        description: error.message || 'Terjadi kesalahan tak terduga.',
      });
    }
  }, [
    filters,
    incomingStock,
    outgoingStock,
    transactions,
    getDestinationDisplay,
    getNotesDisplay,
  ]);

  // Clear all filters
  const clearFilters = useCallback(() => {
    console.log('Clearing filters');
    setFilters({
      startDate: '',
      endDate: '',
      lobsterType: 'all',
      transactionType: 'all',
      page: 1,
    });
    setTransactions([]);
    setTotalItems(0);
    setIncomingStock(0);
    setOutgoingStock(0);
  }, []);

  // Initial data fetch and real-time subscription
  useEffect(() => {
    if (user && !error) {
      const initialize = async () => {
        setTableLoading(true);
        try {
          await Promise.all([fetchTransactions(), fetchReferenceData()]);
        } catch (err) {
          setError(err.message);
        } finally {
          setTableLoading(false);
        }
      };
      initialize();

      const subscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'transactions' },
          () => {
            console.log('Real-time update triggered');
            fetchTransactions();
          }
        )
        .subscribe();

      return () => supabase.removeChannel(subscription);
    }
  }, [user, error, fetchTransactions]);

  // Fetch transactions when filters or itemsPerPage change
  useEffect(() => {
    if (user && !error) {
      fetchTransactions();
    }
  }, [user, error, filters, itemsPerPage, fetchTransactions]);

  // Pagination controls
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const handlePreviousPage = useCallback(() => {
    if (filters.page > 1) {
      setFilters((prev) => ({ ...prev, page: prev.page - 1 }));
    }
  }, [filters.page]);

  const handleNextPage = useCallback(() => {
    if (filters.page < totalPages) {
      setFilters((prev) => ({ ...prev, page: prev.page + 1 }));
    }
  }, [filters.page, totalPages]);

  // Render loading state (initial auth)
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-6 pt-0">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-96 w-full" />
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Render unauthenticated state
  if (!user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-6 pt-0">
            <p className="text-gray-500 dark:text-gray-400">
              Silakan masuk untuk melihat transaksi.
            </p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Render error state
  if (error) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-6 pt-0">
            <p className="text-red-500 dark:text-red-400">Kesalahan: {error}</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Main render
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <div className="flex justify-between items-center">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Riwayat Transaksi
            </h2>
            <Button
              onClick={exportToPDF}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-md"
              disabled={tableLoading}
            >
              Unduh PDF
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  startDate: e.target.value,
                  page: 1,
                }))
              }
              placeholder="Tanggal Mulai"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md"
            />
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  endDate: e.target.value,
                  page: 1,
                }))
              }
              placeholder="Tanggal Selesai"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md"
            />
            <Select
              value={filters.lobsterType}
              onValueChange={(value) =>
                setFilters((prev) => ({ ...prev, lobsterType: value, page: 1 }))
              }
            >
              <SelectTrigger className="w-[180px] bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md">
                <SelectValue placeholder="Pilih Jenis Lobster" />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <SelectItem value="all">Semua Jenis</SelectItem>
                {lobsterTypes.map((type) => (
                  <SelectItem key={type.id} value={type.name}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.transactionType}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  transactionType: value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-[180px] bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md">
                <SelectValue placeholder="Pilih Jenis Transaksi" />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <SelectItem value="all">Semua Jenis Transaksi</SelectItem>
                {transactionTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {transactionTypeDisplay[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={clearFilters}
              className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              disabled={tableLoading}
            >
              Hapus Filter
            </Button>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <Table>
              <TableCaption className="text-gray-600 dark:text-gray-400">
                Transaksi Terakhir | Lobster Masuk: {incomingStock} Ekor |
                Lobster Keluar: {outgoingStock} Ekor
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px] font-semibold text-gray-900 dark:text-gray-100">
                    Jenis Transaksi
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 dark:text-gray-100">
                    Jenis Lobster
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 dark:text-gray-100">
                    Berat Lobster
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 dark:text-gray-100">
                    Jumlah
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 dark:text-gray-100">
                    Tujuan/Asal
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 dark:text-gray-100">
                    Catatan
                  </TableHead>
                  <TableHead className="text-right font-semibold text-gray-900 dark:text-gray-100">
                    Tanggal
                  </TableHead>
                  <TableHead className="text-right font-semibold text-gray-900 dark:text-gray-100">
                    Aksi
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell>
                        <Skeleton className="h-4 w-[100px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[120px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[100px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[80px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[100px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[150px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[100px] ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[100px] ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-gray-500 dark:text-gray-400"
                    >
                      Tidak ada transaksi ditemukan untuk filter ini.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((t) => (
                    <TableRow
                      key={`${t.id}`}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <TableCell className="font-medium">
                        {transactionTypeDisplay[t.transaction_type] ||
                          'Tidak Diketahui'}
                      </TableCell>
                      <TableCell>
                        {t.lobster_types?.name || 'Tidak Ada'}
                      </TableCell>
                      <TableCell>
                        {`${t.weight_classes?.weight_range} gram` ||
                          'Tidak Ada'}
                      </TableCell>
                      <TableCell
                        className={getTransactionColor(t.transaction_type)}
                      >
                        {Math.abs(t.quantity) ?? 0} Ekor
                      </TableCell>
                      <TableCell>
                        {getDestinationDisplay(t.destination)}
                      </TableCell>
                      <TableCell>{getNotesDisplay(t.notes)}</TableCell>
                      <TableCell className="text-right">
                        {t.transaction_date
                          ? format(
                              new Date(t.transaction_date),
                              'dd MMMM yyyy',
                              {
                                locale: id,
                              }
                            )
                          : 'Tidak Ada'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(t)}
                          className="border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900"
                          disabled={tableLoading}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-400">
                Baris per halaman:
              </span>
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(value) => {
                  setItemsPerPage(Number(value));
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <SelectTrigger className="w-[80px] bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handlePreviousPage}
                disabled={filters.page === 1 || tableLoading}
                className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                Sebelumnya
              </Button>
              <span className="text-gray-600 dark:text-gray-400">
                Halaman {filters.page} dari {totalPages || 1}
              </span>
              <Button
                variant="outline"
                onClick={handleNextPage}
                disabled={filters.page >= totalPages || tableLoading}
                className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                Selanjutnya
              </Button>
            </div>
          </div>
        </div>

        {/* Edit Transaction Modal */}
        <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
          <DialogContent className="sm:max-w-[600px] bg-white dark:bg-gray-800">
            <DialogHeader>
              <DialogTitle className="text-gray-900 dark:text-gray-100">
                Edit Transaksi
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="transaction_type"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Jenis Transaksi
                </Label>
                <Select
                  id="transaction_type"
                  value={editForm.transaction_type}
                  onValueChange={(value) =>
                    handleEditFormChange('transaction_type', value)
                  }
                  className="col-span-3"
                >
                  <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                    <SelectValue placeholder="Pilih Jenis Transaksi" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {transactionTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {transactionTypeDisplay[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="type_id"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Jenis Lobster
                </Label>
                <Select
                  id="type_id"
                  value={editForm.type_id}
                  onValueChange={(value) =>
                    handleEditFormChange('type_id', value)
                  }
                  className="col-span-3"
                >
                  <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                    <SelectValue placeholder="Pilih Jenis Lobster" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {lobsterTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="weight_class_id"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Kelas Berat
                </Label>
                <Select
                  id="weight_class_id"
                  value={editForm.weight_class_id}
                  onValueChange={(value) =>
                    handleEditFormChange('weight_class_id', value)
                  }
                  className="col-span-3"
                >
                  <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                    <SelectValue placeholder="Pilih Kelas Berat" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {weightClasses.map((wc) => (
                      <SelectItem key={wc.id} value={wc.id}>
                        {wc.weight_range} gram
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="quantity"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Jumlah (Ekor)
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  value={editForm.quantity}
                  onChange={(e) =>
                    handleEditFormChange('quantity', e.target.value)
                  }
                  className="col-span-3 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                  min="1"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="transaction_date"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Tanggal
                </Label>
                <Input
                  id="transaction_date"
                  type="date"
                  value={editForm.transaction_date}
                  onChange={(e) =>
                    handleEditFormChange('transaction_date', e.target.value)
                  }
                  className="col-span-3 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="destination"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Tujuan/Asal
                </Label>
                <Input
                  id="destination"
                  value={editForm.destination}
                  onChange={(e) =>
                    handleEditFormChange('destination', e.target.value)
                  }
                  className="col-span-3 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                  placeholder="Opsional"
                />
              </div>
              <div className="grid grid-cols-4 items-start gap-4">
                <Label
                  htmlFor="notes"
                  className="text-right text-gray-900 dark:text-gray-100"
                >
                  Catatan
                </Label>
                <Textarea
                  id="notes"
                  value={editForm.notes}
                  onChange={(e) =>
                    handleEditFormChange('notes', e.target.value)
                  }
                  className="col-span-3 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                  placeholder="Opsional"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditModalOpen(false)}
                className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
              >
                Batal
              </Button>
              <Button
                onClick={handleEditSubmit}
                className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white"
              >
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  );
}
