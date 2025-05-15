'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import debounce from 'lodash/debounce';

export default function Transaksi() {
  const [user, setUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [lobsterTypes, setLobsterTypes] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLobsterType, setSelectedLobsterType] = useState('all');
  const [selectedTransactionType, setSelectedTransactionType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  const transactionTypes = ['all', 'ADD', 'DISTRIBUTE', 'DEATH', 'DAMAGED'];

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

  // Fetch lobster types for filter dropdown
  const fetchLobsterTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('lobster_types')
        .select('name')
        .order('name');
      if (error) throw error;
      setLobsterTypes(data.map((type) => type.name));
    } catch (error) {
      toast.error('Gagal Memuat Jenis Lobster', {
        description: error.message,
      });
    }
  };

  // Fetch transactions with filters and pagination
  const fetchTransactions = useCallback(async () => {
    try {
      setTableLoading(true);
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      // Count total transactions for pagination
      const countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      // Main query for transactions
      const query = supabase
        .from('transactions')
        .select(
          `
          transaction_type,
          quantity,
          transaction_date,
          notes,
          lobster_types (name),
          weight_classes (weight_range)
        `
        )
        .order('transaction_date', { ascending: false })
        .range(from, to);

      if (startDate)
        query.gte('transaction_date', new Date(startDate).toISOString());
      if (endDate)
        query.lte('transaction_date', new Date(endDate).toISOString());
      if (selectedLobsterType !== 'all') {
        const { data: typeData } = await supabase
          .from('lobster_types')
          .select('id')
          .eq('name', selectedLobsterType)
          .single();
        if (typeData) {
          query.eq('type_id', typeData.id);
          countQuery.eq('type_id', typeData.id);
        }
      }
      if (selectedTransactionType !== 'all') {
        query.eq('transaction_type', selectedTransactionType);
        countQuery.eq('transaction_type', selectedTransactionType);
      }

      const [{ data, error }, { count }] = await Promise.all([
        query,
        countQuery,
      ]);

      if (error) throw error;
      setTransactions(data || []);
      setTotalItems(count || 0);
    } catch (error) {
      setError(error.message);
      toast.error('Gagal Memuat Transaksi', {
        description: error.message,
      });
    } finally {
      setTableLoading(false);
    }
  }, [
    startDate,
    endDate,
    selectedLobsterType,
    selectedTransactionType,
    currentPage,
    itemsPerPage,
  ]);

  // Debounced fetch
  const debouncedFetchTransactions = useCallback(
    debounce(fetchTransactions, 300, { leading: false, trailing: true }),
    [fetchTransactions]
  );

  // Clean up debounce on component unmount
  useEffect(() => {
    return () => {
      debouncedFetchTransactions.cancel();
    };
  }, [debouncedFetchTransactions]);

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
        return 'text-black';
    }
  }, []);

  // Map transaction types to Bahasa Indonesia for display
  const transactionTypeDisplay = {
    ADD: 'Penambahan',
    DISTRIBUTE: 'Distribusi',
    DEATH: 'Kematian',
    DAMAGED: 'Kerusakan',
    all: 'Semua Jenis Transaksi',
  };

  // Export transactions to PDF (all filtered transactions)
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
        startDate
          ? `Dari: ${format(new Date(startDate), 'dd MMMM yyyy', {
              locale: id,
            })}`
          : '',
        endDate
          ? `Sampai: ${format(new Date(endDate), 'dd MMMM yyyy', {
              locale: id,
            })}`
          : '',
        selectedLobsterType !== 'all'
          ? `Jenis Lobster: ${selectedLobsterType}`
          : 'Jenis Lobster: Semua',
        selectedTransactionType !== 'all'
          ? `Jenis Transaksi: ${transactionTypeDisplay[selectedTransactionType]}`
          : '',
      ]
        .filter(Boolean)
        .join(' | ');

      doc.text('Riwayat Transaksi', 14, 20);
      if (filterText) doc.text(filterText, 14, 27);

      // Fetch all transactions for PDF (no pagination)
      const query = supabase
        .from('transactions')
        .select(
          `
          transaction_type,
          quantity,
          transaction_date,
          notes,
          lobster_types (name),
          weight_classes (weight_range)
        `
        )
        .order('transaction_date', { ascending: false });

      if (startDate)
        query.gte('transaction_date', new Date(startDate).toISOString());
      if (endDate)
        query.lte('transaction_date', new Date(endDate).toISOString());
      if (selectedLobsterType !== 'all') {
        const { data: typeData } = await supabase
          .from('lobster_types')
          .select('id')
          .eq('name', selectedLobsterType)
          .single();
        if (typeData) query.eq('type_id', typeData.id);
      }
      if (selectedTransactionType !== 'all') {
        query.eq('transaction_type', selectedTransactionType);
      }

      const { data, error } = await query;
      if (error) throw error;

      autoTable(doc, {
        startY: filterText ? 34 : 30,
        head: [['Jenis', 'Lobster', 'Berat', 'Jumlah', 'Catatan', 'Tanggal']],
        body: (data || []).map((t) => [
          transactionTypeDisplay[t.transaction_type] || 'Tidak Diketahui',
          t.lobster_types?.name || 'Tidak Ada',
          `${t.weight_classes?.weight_range} gram` || 'Tidak Ada',
          `${Math.abs(t.quantity) ?? 0} Ekor`,
          getNotesDisplay(t.notes),
          t.transaction_date
            ? format(new Date(t.transaction_date), 'dd MMMM yyyy', {
                locale: id,
              })
            : 'Tidak Ada',
        ]),
      });

      // Build dynamic filename
      const filenameParts = ['transaksi'];
      if (startDate || endDate) {
        const start = startDate
          ? format(new Date(startDate), 'yyyyMMdd')
          : 'tanpa_tanggal_mulai';
        const end = endDate
          ? format(new Date(endDate), 'yyyyMMdd')
          : 'tanpa_tanggal_selesai';
        filenameParts.push(`${start}-${end}`);
      }
      if (selectedLobsterType !== 'all') {
        filenameParts.push(
          selectedLobsterType
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_-]/g, '')
        );
      } else {
        filenameParts.push('SemuaJenis');
      }
      if (selectedTransactionType !== 'all') {
        filenameParts.push(selectedTransactionType);
      } else {
        filenameParts.push('SemuaTransaksi');
      }
      const filename = `${filenameParts.join('_')}.pdf`;

      doc.save(filename);
      toast.success('PDF Berhasil Diunduh', {
        description: `Riwayat transaksi yang difilter disimpan sebagai ${filename}`,
      });
    } catch (error) {
      toast.error('Ekspor PDF Gagal', {
        description: error.message || 'Terjadi kesalahan tak terduga.',
      });
    }
  }, [
    startDate,
    endDate,
    selectedLobsterType,
    selectedTransactionType,
    getNotesDisplay,
  ]);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setStartDate('');
    setEndDate('');
    setSelectedLobsterType('all');
    setSelectedTransactionType('all');
    setCurrentPage(1); // Reset to first page
    debouncedFetchTransactions.cancel();
    fetchTransactions();
  }, [debouncedFetchTransactions, fetchTransactions]);

  // Initial data fetch (after auth)
  useEffect(() => {
    if (user && !error) {
      const initialize = async () => {
        setTableLoading(true);
        try {
          await Promise.all([fetchTransactions(), fetchLobsterTypes()]);
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
          debouncedFetchTransactions
        )
        .subscribe();

      return () => supabase.removeChannel(subscription);
    }
  }, [user, error, debouncedFetchTransactions, fetchTransactions]);

  // Fetch transactions when filters or pagination change
  useEffect(() => {
    if (user && !error) {
      debouncedFetchTransactions();
    }
  }, [
    user,
    startDate,
    endDate,
    selectedLobsterType,
    selectedTransactionType,
    currentPage,
    itemsPerPage,
    debouncedFetchTransactions,
    error,
  ]);

  // Pagination controls
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const handlePreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  }, [currentPage, totalPages]);

  // Memoized filter inputs
  const filterInputs = useMemo(
    () => (
      <div className="flex flex-col sm:flex-row gap-4">
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="Tanggal Mulai"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="Tanggal Selesai"
        />
        <Select
          value={selectedLobsterType}
          onValueChange={setSelectedLobsterType}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Pilih Jenis Lobster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis</SelectItem>
            {lobsterTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={selectedTransactionType}
          onValueChange={setSelectedTransactionType}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Pilih Jenis Transaksi" />
          </SelectTrigger>
          <SelectContent>
            {transactionTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {transactionTypeDisplay[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={clearFilters}>
          Hapus Filter
        </Button>
      </div>
    ),
    [
      startDate,
      endDate,
      selectedLobsterType,
      selectedTransactionType,
      lobsterTypes,
      transactionTypes,
      clearFilters,
    ]
  );

  // Memoized pagination controls
  const paginationControls = useMemo(
    () => (
      <div className="flex items-center justify-between gap-4 mt-4">
        <div className="flex items-center gap-2">
          <span>Baris per halaman:</span>
          <Select
            value={itemsPerPage.toString()}
            onValueChange={(value) => {
              setItemsPerPage(Number(value));
              setCurrentPage(1); // Reset to first page
            }}
          >
            <SelectTrigger className="w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
            disabled={currentPage === 1}
          >
            Sebelumnya
          </Button>
          <span>
            Halaman {currentPage} dari {totalPages || 1}
          </span>
          <Button
            variant="outline"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
          >
            Selanjutnya
          </Button>
        </div>
      </div>
    ),
    [itemsPerPage, currentPage, totalPages, handlePreviousPage, handleNextPage]
  );

  // Render loading state (only for initial auth)
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p>Memuat autentikasi...</p>
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
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p>Silakan masuk untuk melihat transaksi.</p>
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
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p className="text-red-500">Kesalahan: {error}</p>
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
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Riwayat Transaksi</h2>
            <Button onClick={exportToPDF}>Unduh PDF</Button>
          </div>
          {filterInputs}
          <Table>
            <TableCaption>Transaksi Terakhir</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Jenis Transaksi</TableHead>
                <TableHead>Jenis Lobster</TableHead>
                <TableHead>Berat Lobster</TableHead>
                <TableHead>Jumlah Lobster</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead className="text-right">Tanggal Transaksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <Skeleton className="h-4 w-[80px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[100px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[120px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[80px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[150px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[100px] ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    Tidak ada transaksi ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((t) => (
                  <TableRow
                    key={`${t.transaction_date}-${t.transaction_type}-${
                      t.lobster_types?.name || 'tidak_diketahui'
                    }-${t.weight_classes?.weight_range || 'tidak_diketahui'}`}
                  >
                    <TableCell className="font-medium">
                      {transactionTypeDisplay[t.transaction_type] ||
                        'Tidak Diketahui'}
                    </TableCell>
                    <TableCell>
                      {t.lobster_types?.name || 'Tidak Ada'}
                    </TableCell>
                    <TableCell>
                      {`${t.weight_classes?.weight_range} gram` || 'Tidak Ada'}
                    </TableCell>
                    <TableCell
                      className={getTransactionColor(t.transaction_type)}
                    >
                      {Math.abs(t.quantity) ?? 0} Ekor
                    </TableCell>
                    <TableCell>{getNotesDisplay(t.notes)}</TableCell>
                    <TableCell className="text-right">
                      {t.transaction_date
                        ? format(new Date(t.transaction_date), 'dd MMMM yyyy', {
                            locale: id,
                          })
                        : 'Tidak Ada'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {paginationControls}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
