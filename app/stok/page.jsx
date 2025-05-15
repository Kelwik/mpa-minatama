'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getLobsterTypes, getWeightClasses } from '@/lib/cache';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AppSidebar } from '@/components/app-sidebar';

import debounce from 'lodash/debounce';

// Format current date/time for datetime-local
const getCurrentDateTime = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(now.getDate()).padStart(2, '0')}T${String(
    now.getHours()
  ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

// Form schema
const formSchema = z
  .object({
    lobsterType: z.string().min(1, 'Lobster type is required'),
    weightClass: z.string().min(1, 'Weight class is required'),
    quantity: z.number().min(1, 'Quantity must be at least 1').int(),
    transactionType: z.enum(['ADD', 'DISTRIBUTE', 'DEATH', 'DAMAGED']),
    destination: z.string().optional(),
    note: z.string().optional(),
    transactionDate: z
      .string()
      .min(1, 'Transaction date is required')
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid date format',
      }),
  })
  .refine(
    (data) => {
      if (['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(data.transactionType)) {
        return data.destination && data.destination.trim() !== '';
      }
      return true;
    },
    {
      message: 'Destination is required for this transaction type',
      path: ['destination'],
    }
  );

export default function Stock() {
  const [user, setUser] = useState(null);
  const [stockByType, setStockByType] = useState([]);
  const [weightClasses, setWeightClasses] = useState({});
  const [lobsterTypes, setLobsterTypes] = useState([]);
  const [allWeightClasses, setAllWeightClasses] = useState([]);
  const [availableStock, setAvailableStock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form setup
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lobsterType: '',
      weightClass: '',
      quantity: 1,
      transactionType: 'ADD',
      destination: '',
      note: '',
      transactionDate: getCurrentDateTime(),
    },
  });

  // Check authentication
  const fetchSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setUser(session?.user || null);
    setLoading(false);
  }, []);

  // Fetch stock by type
  const fetchStockByType = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('type_id, quantity');
      if (error) throw error;

      const lobsterTypesData = await getLobsterTypes(supabase);
      const grouped = data.reduce((acc, row) => {
        const type = lobsterTypesData.find((t) => t.id === row.type_id);
        const typeName = type?.name;
        if (typeName)
          acc[typeName] = (acc[typeName] || 0) + (row.quantity || 0);
        return acc;
      }, {});
      const stockByTypeArray = Object.entries(grouped).map(
        ([name, total_quantity]) => ({
          lobster_type: name,
          total_quantity,
        })
      );
      setStockByType(stockByTypeArray);
    } catch (error) {
      setError(error.message);
    }
  }, []);

  // Fetch weight classes for all types
  const fetchWeightClasses = useCallback(
    async (types) => {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out')), 3000)
        );

        const { data: inventoryData, error } = await Promise.race([
          supabase
            .from('inventory')
            .select(
              'type_id, weight_class_id, quantity, weight_classes!inner(weight_range)'
            )
            .in(
              'type_id',
              types
                .map(
                  (t) =>
                    lobsterTypes.find((lt) => lt.name === t.lobster_type)?.id
                )
                .filter(Boolean)
            )
            .gt('quantity', 0),
          timeoutPromise,
        ]);
        if (error) throw error;

        const newWeightClasses = types.reduce((acc, type) => {
          const typeId = lobsterTypes.find(
            (lt) => lt.name === type.lobster_type
          )?.id;
          acc[type.lobster_type] = inventoryData
            .filter((row) => row.type_id === typeId)
            .map((row) => ({
              weight_range: row.weight_classes?.weight_range || 'Unknown',
              quantity: row.quantity || 0,
            }));
          return acc;
        }, {});
        setWeightClasses(newWeightClasses);
      } catch {
        setWeightClasses(
          types.reduce((acc, type) => ({ ...acc, [type.lobster_type]: [] }), {})
        );
      }
    },
    [lobsterTypes]
  );

  // Fetch form options
  const fetchFormOptions = useCallback(async () => {
    try {
      const [typesData, weightClassesData] = await Promise.all([
        getLobsterTypes(supabase),
        getWeightClasses(supabase),
      ]);
      setLobsterTypes(typesData);
      setAllWeightClasses(weightClassesData);
    } catch (error) {
      setError(error.message);
    }
  }, []);

  // Fetch available stock
  const fetchAvailableStock = useCallback(async (lobsterType, weightClass) => {
    if (!lobsterType || !weightClass) {
      setAvailableStock(null);
      return;
    }
    try {
      const [typeData, weightClassData] = await Promise.all([
        supabase
          .from('lobster_types')
          .select('id')
          .eq('name', lobsterType)
          .single(),
        supabase
          .from('weight_classes')
          .select('id')
          .eq('weight_range', weightClass)
          .single(),
      ]);
      if (typeData.error || weightClassData.error)
        throw new Error('Invalid type or weight class');

      const { data: inventoryData, error } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('type_id', typeData.data.id)
        .eq('weight_class_id', weightClassData.data.id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;

      setAvailableStock(inventoryData?.quantity || 0);
    } catch {
      setAvailableStock(0);
    }
  }, []);

  // Debounced fetch available stock
  const debouncedFetchAvailableStock = useMemo(
    () =>
      debounce(fetchAvailableStock, 300, { leading: false, trailing: true }),
    [fetchAvailableStock]
  );

  // Submit transaction
  const submitTransaction = useCallback(
    async (values) => {
      try {
        setFormError(null);
        setIsSubmitting(true);
        const {
          lobsterType,
          weightClass,
          quantity,
          transactionType,
          destination,
          note,
          transactionDate,
        } = values;

        const [typeData, weightClassData] = await Promise.all([
          supabase
            .from('lobster_types')
            .select('id')
            .eq('name', lobsterType)
            .single(),
          supabase
            .from('weight_classes')
            .select('id')
            .eq('weight_range', weightClass)
            .single(),
        ]);
        if (typeData.error || weightClassData.error)
          throw new Error('Invalid type or weight class');

        if (['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(transactionType)) {
          const { data: inventoryData, error } = await supabase
            .from('inventory')
            .select('quantity')
            .eq('type_id', typeData.data.id)
            .eq('weight_class_id', weightClassData.data.id)
            .single();
          if (error && error.code !== 'PGRST116') throw error;
          const currentStock = inventoryData?.quantity || 0;
          if (currentStock < quantity) {
            throw new Error(
              `Not enough stock: only ${currentStock} ${lobsterType} (${weightClass}) available`
            );
          }
          if (currentStock === 0) {
            throw new Error(
              `No stock available for ${lobsterType} (${weightClass})`
            );
          }
        }

        const { error: manageError } = await supabase.rpc('manage_inventory', {
          p_type_id: typeData.data.id,
          p_weight_class_id: weightClassData.data.id,
          p_quantity: quantity,
          p_transaction_type: transactionType,
          p_destination: destination || null,
          p_notes: note ? { note } : null,
          p_transaction_date: new Date(transactionDate).toISOString(),
        });
        if (manageError) {
          if (manageError.message.includes('Quantity must be positive')) {
            throw new Error('Quantity must be a positive number');
          }
          if (manageError.message.includes('No inventory exists')) {
            throw new Error(
              `No stock available for ${lobsterType} (${weightClass})`
            );
          }
          if (manageError.message.includes('Insufficient inventory')) {
            const available = manageError.message.match(/\d+/)[0];
            throw new Error(
              `Not enough stock: only ${available} ${lobsterType} (${weightClass}) available`
            );
          }
          if (manageError.message.includes('Validation failed')) {
            throw new Error(
              `Not enough stock for ${lobsterType} (${weightClass})`
            );
          }
          if (manageError.message.includes('Update failed')) {
            throw new Error(
              `No stock available for ${lobsterType} (${weightClass})`
            );
          }
          if (manageError.message.includes('Destination is required')) {
            throw new Error(
              'Destination is required for this transaction type'
            );
          }
          if (
            manageError.message.includes('function public.manage_inventory')
          ) {
            throw new Error(
              'Database function manage_inventory not found. Please contact support.'
            );
          }
          throw new Error(manageError.message);
        }

        await fetchStockByType();
        await fetchWeightClasses(stockByType);
        form.reset({
          lobsterType: '',
          weightClass: '',
          quantity: 1,
          transactionType: 'ADD',
          destination: '',
          note: '',
          transactionDate: getCurrentDateTime(),
        });
        setIsModalOpen(false);
        setAvailableStock(null);
        toast.success('Transaction Successful', {
          description: `${quantity} ${lobsterType} (${weightClass}) ${
            transactionType === 'ADD'
              ? 'added'
              : transactionType === 'DISTRIBUTE'
              ? 'distributed'
              : transactionType === 'DEATH'
              ? 'distributed as died'
              : 'distributed as damaged'
          } on ${new Date(transactionDate).toLocaleString('id-ID', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}.`,
          action: {
            label: 'View Transactions',
            onClick: () => (window.location.href = '/transaksi'),
          },
        });
      } catch (error) {
        setFormError(error.message);
        toast.error('Transaction Failed', { description: error.message });
      } finally {
        setIsSubmitting(false);
      }
    },
    [fetchStockByType, stockByType, fetchWeightClasses]
  );

  // Watch form changes
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.lobsterType && value.weightClass) {
        debouncedFetchAvailableStock(value.lobsterType, value.weightClass);
      } else {
        setAvailableStock(null);
      }
    });
    return () => {
      subscription.unsubscribe();
      debouncedFetchAvailableStock.cancel();
    };
  }, [form, debouncedFetchAvailableStock]);

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      const initialize = async () => {
        await Promise.all([fetchStockByType(), fetchFormOptions()]);
        await fetchWeightClasses(stockByType);
      };
      initialize();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory' },
          async (payload) => {
            await fetchStockByType();
            const affectedTypeId = payload.new.type_id;
            const affectedType = lobsterTypes.find(
              (t) => t.id === affectedTypeId
            )?.name;
            if (affectedType)
              await fetchWeightClasses([{ lobster_type: affectedType }]);
            if (
              form.getValues('lobsterType') &&
              form.getValues('weightClass')
            ) {
              debouncedFetchAvailableStock(
                form.getValues('lobsterType'),
                form.getValues('weightClass')
              );
            }
          }
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          async (payload) => {
            await fetchStockByType();
            const affectedTypeId = payload.new.type_id;
            const affectedType = lobsterTypes.find(
              (t) => t.id === affectedTypeId
            )?.name;
            if (affectedType)
              await fetchWeightClasses([{ lobster_type: affectedType }]);
            if (
              form.getValues('lobsterType') &&
              form.getValues('weightClass')
            ) {
              debouncedFetchAvailableStock(
                form.getValues('lobsterType'),
                form.getValues('weightClass')
              );
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
      };
    }
  }, [
    user,
    fetchStockByType,
    fetchFormOptions,
    fetchWeightClasses,
    stockByType,
    lobsterTypes,
    debouncedFetchAvailableStock,
    form,
  ]);

  // Authentication effect
  useEffect(() => {
    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => authListener.subscription?.unsubscribe();
  }, [fetchSession]);

  // Memoized UI data
  const memoizedStockByType = useMemo(() => stockByType, [stockByType]);
  const memoizedWeightClasses = useMemo(() => weightClasses, [weightClasses]);

  // Render loading or error states
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
            <p className="text-gray-500 dark:text-gray-400">Loading stock...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
            <p className="text-gray-500 dark:text-gray-400">
              Please log in to view stock.
            </p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
            <p className="text-red-500 dark:text-red-400">Error: {error}</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Stock Management
            </h2>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white">
                  Add Transaction
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                <DialogHeader>
                  <DialogTitle>Add Transaction</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(submitTransaction)}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="lobsterType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lobster Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                                <SelectValue placeholder="Select lobster type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              {lobsterTypes.map((type) => (
                                <SelectItem key={type.id} value={type.name}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="weightClass"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Weight Class</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                                <SelectValue placeholder="Select weight class" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              {allWeightClasses.map((wc) => (
                                <SelectItem key={wc.id} value={wc.weight_range}>
                                  {wc.weight_range}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Quantity{' '}
                            {availableStock !== null &&
                              ['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(
                                form.watch('transactionType')
                              ) && (
                                <span className="text-sm text-gray-500">
                                  (Available: {availableStock} Ekor)
                                </span>
                              )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseInt(e.target.value))
                              }
                              min="1"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="transactionType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Transaction Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                                <SelectValue placeholder="Select transaction type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              <SelectItem value="ADD">Add</SelectItem>
                              <SelectItem value="DISTRIBUTE">
                                Distribute
                              </SelectItem>
                              <SelectItem value="DEATH">Death</SelectItem>
                              <SelectItem value="DAMAGED">Damaged</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="destination"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Destination{' '}
                            {form.watch('transactionType') !== 'ADD' ? (
                              <span className="text-red-500">*</span>
                            ) : (
                              ''
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              placeholder="Enter destination (e.g., Market, Restaurant)"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="transactionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Transaction Date</FormLabel>
                          <FormControl>
                            <Input
                              type="datetime-local"
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="note"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Note (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {formError && (
                      <p className="text-red-500 dark:text-red-400">
                        {formError}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setIsModalOpen(false)}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? 'Submitting...' : 'Submit Transaction'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Stock by Type */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Stock by Lobster Type
            </h3>
            {memoizedStockByType.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No inventory data available. Add lobsters using the button
                above.
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {memoizedStockByType.map((type) => (
                  <Card
                    key={type.lobster_type}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200"
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {type.lobster_type}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Total
                        </span>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {type.total_quantity} Ekor
                        </span>
                      </div>
                      {memoizedWeightClasses[type.lobster_type]?.length > 0 ? (
                        <div className="space-y-2">
                          {memoizedWeightClasses[type.lobster_type].map(
                            (wc) => (
                              <div
                                key={wc.weight_range}
                                className="flex items-center justify-between py-1 border-t border-gray-100 dark:border-gray-700"
                              >
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                  {wc.weight_range}
                                </span>
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {wc.quantity} Ekor
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                          No weight classes with stock
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
